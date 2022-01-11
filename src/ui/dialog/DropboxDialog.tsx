import * as Moment from 'moment';
import * as React from 'react';

import {
  Tab as BPTab,
  Tabs as BPTabs,
  Button,
  Checkbox,
  ControlGroup,
  Dialog,
  FormGroup,
  HTMLSelect,
  InputGroup,
  Intent,
} from '@blueprintjs/core';
import {
  IDropboxBackupFileRecord,
  VerifyStatus,
  exportToDropbox,
  generateNewDropboxBackupFileName,
  importFromDropbox,
  reloadBackupFiles,
  verifyDropboxAccessToken,
} from '../../dropbox/index';
import { useEffect, useState } from 'react';

import { useSettingItem } from '../../store/localSetting';

export const SETTING_KEY_DROPBOX_ACCESSTOKEN = 'tabverse_dropboxAccessToken';
export const SETTING_KEY_DROPBOX_AUTOBACKUP = 'tabverse_dropboxAutobackup';

function createStyles(): { [k: string]: React.CSSProperties } {
  return {
    container: {
      minWidth: '900px',
      minHeight: '400px',
    },
    dialogIcon: {
      paddingRight: '8px',
      marginLeft: '-8px',
      fontSize: '1.4em',
    },
    dialogInnerContainer: {
      padding: '24px 10px',
    },
    dialogCard: {
      paddingTop: '4px',
      paddingBottom: '4px',
      marginBottom: '20px',
    },
  };
}

const DropboxSetup = ({ accessToken, setAccessToken }: any) => {
  const styles = createStyles();
  const [accessTokenVerifyStatus, setAccessTokenVerifyStatus] =
    useState<VerifyStatus>(VerifyStatus.NotYetPerformed);

  const [autoBackupFlag, setAutoBackupFlag] = useSettingItem<boolean>(
    SETTING_KEY_DROPBOX_AUTOBACKUP,
    (v) => {
      return v && v.toLowerCase() === 'true' ? true : false;
    },
    (v) => (v ? 'true' : 'false'),
  );

  const renderVerifyIndicator = () => {
    switch (accessTokenVerifyStatus) {
      case VerifyStatus.Verifying:
        return <Button loading={true} />;
      case VerifyStatus.Succeeded:
        return <Button intent={Intent.SUCCESS} text="Verified" />;
      case VerifyStatus.Failed:
        return <Button intent={Intent.DANGER} text="Failed" />;
      default:
        return <span></span>;
    }
  };

  useEffect(() => {
    verifyDropboxAccessToken(
      accessToken,
      (status) => setAccessTokenVerifyStatus(status),
      () => {},
    );
  }, [accessToken]);

  return (
    <div style={styles.dialogCard}>
      <h3>Dropbox Authentication</h3>
      <FormGroup
        helperText={
          <p>
            The access token for read/write your dropbox folder. Follow{' '}
            <a
              href="https://liyu1981.github.io/tabverse/docs/dropbox"
              target="_blank"
              rel="noreferrer"
            >
              instructions
            </a>{' '}
            here to get one.
          </p>
        }
        label="Dropbox Access Token"
        labelFor="access-token-input"
        inline={true}
      >
        <InputGroup
          id="access-token-input"
          placeholder="paste your access token here"
          value={accessToken}
          onChange={(event) => {
            setAccessToken(event.target.value);
          }}
          onBlur={() => {
            verifyDropboxAccessToken(
              accessToken,
              (status) => setAccessTokenVerifyStatus(status),
              (accessToken: string) => setAccessToken(accessToken),
            );
          }}
          rightElement={renderVerifyIndicator()}
          fill={true}
        />
      </FormGroup>
      {/* <FormGroup
        helperText="If checked, we will backup your data every 5mins to dropbox if there is change."
        label="Automatically backup data to Dropbox?"
        labelFor="auto-backup-checker"
        inline={true}
      >
        <Checkbox
          checked={autoBackupFlag}
          onChange={() => setAutoBackupFlag(!autoBackupFlag)}
        />
      </FormGroup> */}
    </div>
  );
};

interface IDropboxExportProps {
  accessToken: string;
}

interface ITargetFileRecord {
  targetFilePath: string;
  done: boolean;
}

const DropboxExport = ({ accessToken }: IDropboxExportProps) => {
  const styles = createStyles();
  const [targetFileRecord, setTargetFileRecord] =
    useState<ITargetFileRecord>(null);
  const [inBackup, setInBackup] = useState(false);

  const backupAction = async () => {
    const targetFilePath = generateNewDropboxBackupFileName();
    setTargetFileRecord({ targetFilePath, done: false });
    setInBackup(true);
    await exportToDropbox(accessToken, targetFilePath);
    setTargetFileRecord({ targetFilePath, done: true });
    setInBackup(false);
  };

  return (
    <div style={styles.dialogCard}>
      <h3>Export backups to Dropbox</h3>
      <div>
        <div>
          {targetFileRecord ? (
            <span>
              <b>Backup To: </b>
              {targetFileRecord.targetFilePath}
              {targetFileRecord.done ? '(done)' : ''}
            </span>
          ) : (
            ''
          )}
        </div>
        {inBackup ? (
          <Button loading={true} />
        ) : (
          <Button text="Export" onClick={backupAction} />
        )}
      </div>
    </div>
  );
};

interface IDropboxImportProps {
  accessToken: string;
}

const DropboxImport = ({ accessToken }: IDropboxImportProps) => {
  const styles = createStyles();
  const [selectedPath, setSelectedPath] =
    useState<IDropboxBackupFileRecord>(null);
  const [allPaths, setAllPaths] = useState<IDropboxBackupFileRecord[]>([]);
  const [inImporting, setInImporting] = useState(false);

  const renderPathOptions = () => {
    return allPaths.map((path, index) => {
      const serverModifiedTime = Date.parse(path.server_modified);
      return (
        <option key={index} value={path.path_lower}>
          {path.path_lower} ({Moment(serverModifiedTime).calendar()})
        </option>
      );
    });
  };

  const reloadBackups = async () => {
    const records = await reloadBackupFiles(accessToken);
    setAllPaths(records);
    if (records.length >= 1) {
      setSelectedPath(records[0]);
    }
  };

  const importBackup = async () => {
    setInImporting(true);
    await importFromDropbox(accessToken, selectedPath.path_lower);
    setInImporting(false);
  };

  return (
    <div style={styles.dialogCard}>
      <h3>Import from Dropbox backups</h3>
      <div>
        <FormGroup
          helperText="Click refresh to reload files from your dropbox."
          label="Dropbox Backup File"
          labelFor="backup-file-input"
          inline={true}
        >
          <ControlGroup>
            <HTMLSelect
              value={selectedPath?.path_lower ?? ''}
              onChange={(ev) => {
                const path = allPaths.find(
                  (path) => path.path_lower === ev.target.value,
                );
                setSelectedPath(path);
              }}
            >
              {renderPathOptions()}
            </HTMLSelect>
            <Button icon="reset" text="Reload" onClick={reloadBackups} />
          </ControlGroup>
        </FormGroup>
        {inImporting ? (
          <Button loading={true} />
        ) : (
          <Button text="Import" onClick={importBackup} />
        )}
      </div>
    </div>
  );
};

interface IDropboxDialogProps {
  isOpen: boolean;
  onClose: any;
}

export const DropboxDialog = (props: IDropboxDialogProps) => {
  const styles = createStyles();

  const [accessToken, setAccessToken] = useSettingItem<string>(
    SETTING_KEY_DROPBOX_ACCESSTOKEN,
    (v) => {
      return v ? v : '';
    },
    (v) => v,
  );

  const isAccessTokenValid = () => accessToken && accessToken.length > 0;

  return (
    <Dialog
      isOpen={props.isOpen}
      onClose={props.onClose}
      canOutsideClickClose={false}
      canEscapeKeyClose={false}
      icon={<i className="fab fa-dropbox" style={styles.dialogIcon}></i>}
      title="Export/Import from/to Dropbox"
      style={styles.container}
    >
      <div style={styles.dialogInnerContainer}>
        <BPTabs renderActiveTabPanelOnly={false} vertical={true}>
          {isAccessTokenValid() ? (
            <BPTab
              id="export"
              title="Export"
              panel={<DropboxExport accessToken={accessToken} />}
              panelClassName="bp3-tab-panel-dialog"
            />
          ) : (
            ''
          )}
          {isAccessTokenValid() ? (
            <BPTab
              id="import"
              title="Import"
              panel={<DropboxImport accessToken={accessToken} />}
              panelClassName="bp3-tab-panel-dialog"
            />
          ) : (
            ''
          )}
          <BPTab
            id="setup"
            title="Setup"
            panel={
              <DropboxSetup
                accessToken={accessToken}
                setAccessToken={setAccessToken}
              />
            }
            panelClassName="bp3-tab-panel-dialog"
          />
        </BPTabs>
      </div>
    </Dialog>
  );
};
