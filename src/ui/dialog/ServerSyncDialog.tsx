import {
  Button,
  ButtonGroup,
  Callout,
  Checkbox,
  Dialog,
  DialogBody,
  FormGroup,
  Icon,
  InputGroup,
  Intent,
  Spinner,
  Tab,
  Tabs,
} from '@blueprintjs/core';
import React, { useCallback, useEffect, useState } from 'react';

import { logger } from '../../global';
import { formatDateTime, fromNow } from '../../time';
import classes from './ServerSyncDialog.module.scss';
import { useSyncActivity } from '../common/useSyncActivity';
import {
  SyncRuntime,
  startBackgroundSync,
  stopBackgroundSync,
  uploadAllLocalRecords,
} from '../../data/repo/backgroundSync';
import { countLocalRecords, LocalRecordCounts } from '../../data/repo/dbBridge';
import { loadSyncState } from '../../data/repo/repo';
import {
  SyncConfig,
  clearSyncConfig,
  loadSyncConfig,
  pairWithServer,
} from '../../data/repo/syncConfig';
import {
  OFFICIAL_CONSOLE_URL,
  OFFICIAL_PAIR_URL,
  OFFICIAL_SERVER_URL,
  closePairWindow,
  newPairNonce,
  officialPairUrl,
  openOfficialPairWindow,
  rememberPendingPair,
  takePendingPair,
} from '../../data/repo/officialServer';
import {
  sendPubSubMessage,
  SyncMsg,
  subscribePubSubMessage,
  unsubscribePubSubMessage,
} from '../../message/message';

/** Which half of the dialog is on screen (adr/0020). */
export type SyncTab = 'status' | 'setup';
/** The two ways to set sync up: the wizard, or a code against a server you run. */
export type SetupMode = 'official' | 'custom';

/**
 * Which tab a freshly loaded dialog opens on: the state the person is in, so
 * that Status means "you are set up" and Setup means "there is something to do".
 * Exported because it is the one decision the two tabs encode, and the dialog
 * itself cannot be rendered past its loading state without a DOM to run effects
 * in (there is none in this repo's tests - see AGENTS.md).
 */
export function initialSyncTab(config: SyncConfig | null): SyncTab {
  return config ? 'status' : 'setup';
}

/** How the status says which server this device is on. */
export function setupLabelOf(config: SyncConfig | null | undefined): string {
  return config && config.kind === 'official'
    ? 'Tabverse official server'
    : 'your own server (pairing code)';
}

interface IStatus {
  intent: Intent;
  text: string;
}

const NOT_CONNECTED: IStatus = {
  intent: Intent.NONE,
  text: 'Not connected: Tabverse runs fully local until you pair it with your own sync server.',
};

export const ServerSyncDialog = (props: {
  isOpen: boolean;
  onClose: () => void;
}) => {
  const { isOpen, onClose } = props;

  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [deviceName, setDeviceName] = useState('chrome');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<IStatus>(NOT_CONNECTED);
  // Uploading what is already on this device is the default when setting sync
  // up (adr/0002 §3); the box is there to turn it off, and the count below it
  // is there so the default is an informed one.
  const [uploadLocal, setUploadLocal] = useState(true);
  const [localCounts, setLocalCounts] = useState<LocalRecordCounts | null>(
    null,
  );
  const [uploadProgress, setUploadProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  // when the last sync cycle finished, read from the cursor the engine keeps
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const syncing = useSyncActivity();

  // The dialog is two tabs: what sync *is* right now, and the two ways to set it
  // up (adr/0020). The default follows the state - configured means Status, not
  // configured means Setup - so opening it on the thing that needs attention.
  const [tab, setTab] = useState<SyncTab>('setup');
  const [setupMode, setSetupMode] = useState<SetupMode>('official');
  // The window the wizard opened lives in a ref rather than state: nothing
  // renders it (the waiting phase is what the panel keys off), and a ref keeps
  // the subscription effect from re-running whenever it changes.
  const [wizardWaiting, setWizardWaiting] = useState(false);
  const wizardWindowIdRef = React.useRef<number | null>(null);

  const hasLocalData = (localCounts ? localCounts.total : 0) > 0;

  const refreshLastSync = useCallback(async () => {
    try {
      const state = await loadSyncState();
      setLastSyncAt(
        typeof state.last_sync_at === 'number' ? state.last_sync_at : null,
      );
    } catch (err) {
      logger.log('sync dialog: cannot read the sync state', err);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    let cancelled = false;
    setLoaded(false);
    loadSyncConfig()
      .then((cfg) => {
        if (cancelled) {
          return;
        }
        setConfig(cfg);
        setTab(initialSyncTab(cfg));
        if (cfg) {
          setStatus({
            intent: Intent.SUCCESS,
            text: `Connected to ${cfg.baseUrl}`,
          });
          void refreshLastSync();
        } else {
          // Not paired yet: measure what an upload would send, so the size of
          // the default is visible before the user commits to it.
          countLocalRecords()
            .then((counts) => {
              if (!cancelled) {
                setLocalCounts(counts);
              }
            })
            .catch((err) => {
              logger.log('sync dialog: cannot count local records', err);
            });
        }
        setLoaded(true);
      })
      .catch((err) => {
        logger.log('sync dialog: cannot read config', err);
        if (!cancelled) {
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, refreshLastSync]);

  // The worker is what takes the token from the wizard page (adr/0020): it is
  // the context that is always there, and it owns the config. This page is the
  // one watching, so it redraws as connected when that happens, and closes the
  // window it opened - the wizard has already said it can be closed.
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const token = subscribePubSubMessage(SyncMsg.ConfigChanged, () => {
      void loadSyncConfig()
        .then(async (cfg) => {
          if (!cfg) return;
          setConfig(cfg);
          setTab('status');
          setStatus({
            intent: Intent.SUCCESS,
            text: `Connected to ${cfg.baseUrl}`,
          });
          setWizardWaiting(false);
          await closePairWindow(wizardWindowIdRef.current);
          wizardWindowIdRef.current = null;
          void refreshLastSync();
          // the same first cycle the code pairing gives: the runtime is per
          // context, so the page starts one here, and the worker picks the
          // config up on its next wake - the same pattern `onPair` below uses
          void startBackgroundSync().catch(() => undefined);
        })
        .catch((err) => {
          logger.log('sync dialog: config did not come back', err);
        });
    });
    return () => unsubscribePubSubMessage(token);
  }, [isOpen, refreshLastSync]);

  const runAction = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err: any) {
      setStatus({
        intent: Intent.DANGER,
        text: `Failed: ${err && err.message ? err.message : String(err)}`,
      });
    } finally {
      setBusy(false);
    }
  };

  const startOfficialWizard = () =>
    runAction(async () => {
      // The nonce is the whole handshake: it goes in the URL, it comes back in
      // the message, and the worker spends it. A message nobody asked for has
      // nothing to match (data/repo/officialServer.ts).
      const nonce = newPairNonce();
      await rememberPendingPair(nonce);
      const windowId = await openOfficialPairWindow(
        officialPairUrl(chrome.runtime.id, nonce),
      );
      wizardWindowIdRef.current = windowId;
      setWizardWaiting(true);
      setStatus({
        intent: Intent.PRIMARY,
        text:
          'A Tabverse window opened. Sign in there and allow this device; ' +
          'the token comes back on its own.',
      });
    });

  const cancelOfficialWizard = async () => {
    await takePendingPair();
    await closePairWindow(wizardWindowIdRef.current);
    wizardWindowIdRef.current = null;
    setWizardWaiting(false);
    setStatus(NOT_CONNECTED);
  };

  const onPair = () =>
    runAction(async () => {
      if (!baseUrl.trim() || !inviteCode.trim()) {
        setStatus({
          intent: Intent.WARNING,
          text: 'Both the server URL and the pairing code are required.',
        });
        return;
      }
      const cfg = await pairWithServer(
        baseUrl.trim(),
        inviteCode.trim(),
        deviceName.trim() || 'chrome',
      );
      setConfig(cfg);
      setInviteCode('');
      // the config changed in this page, so the pages that watch it (the
      // console tool in the right panel) hear it the same way they hear the
      // wizard's arrival: the wizard path broadcasts from the worker, this
      // one has no worker to broadcast from
      sendPubSubMessage(SyncMsg.ConfigChanged, true);
      // the pair itself triggers a first sync cycle, so the time is worth
      // reading as soon as the credentials are in
      void refreshLastSync();
      // start syncing right away (the background worker does the same on its
      // next wake up; both are idempotent)
      const runtime = await startBackgroundSync();

      if (!uploadLocal || !hasLocalData) {
        setStatus({
          intent: Intent.SUCCESS,
          text:
            `Paired with ${cfg.baseUrl}. Your existing data stays on this ` +
            'device; new and changed tabverses sync from now on.',
        });
        return;
      }
      if (!runtime) {
        setStatus({
          intent: Intent.WARNING,
          text: `Paired with ${cfg.baseUrl}, but the upload was skipped: sync is not configured. Use "Upload local data" to retry.`,
        });
        return;
      }

      // Pairing already succeeded at this point, so an upload failure is
      // reported as a failure of the upload and nothing else: the device is
      // paired, the local copy is intact, and the button can retry.
      try {
        setStatus({
          intent: Intent.PRIMARY,
          text: `Paired with ${cfg.baseUrl}. Uploading the data on this device...`,
        });
        const result = await uploadAllLocalRecords(runtime.engine, {
          onProgress: (done, total) => setUploadProgress({ done, total }),
        });
        setUploadProgress(null);
        setStatus({
          intent: result.stale > 0 ? Intent.WARNING : Intent.SUCCESS,
          text:
            `Paired with ${cfg.baseUrl}. Uploaded ${result.uploaded} of ` +
            `${result.total} local record(s)` +
            (result.stale > 0
              ? `; ${result.stale} were already newer on the server.`
              : '.'),
        });
      } catch (err: any) {
        setUploadProgress(null);
        setStatus({
          intent: Intent.WARNING,
          text:
            `Paired with ${cfg.baseUrl}, but the upload failed: ` +
            `${err && err.message ? err.message : String(err)}. ` +
            'Your data is still on this device; use "Upload local data" to retry.',
        });
      }
    });

  const onSyncNow = () =>
    runAction(async () => {
      const runtime: SyncRuntime | null = await startBackgroundSync();
      if (!runtime) {
        setStatus({
          intent: Intent.WARNING,
          text: 'Sync is not configured.',
        });
        return;
      }
      const outcome = await runtime.syncNow();
      await refreshLastSync();
      if (outcome.status === 'ok') {
        setStatus({
          intent: Intent.SUCCESS,
          text:
            `Synced: pushed ${outcome.pushed}, pulled ${outcome.pulled}` +
            (outcome.stale > 0
              ? `, ${outcome.stale} conflict(s) resolved`
              : ''),
        });
      } else if (outcome.status === 'error') {
        setStatus({
          intent: Intent.DANGER,
          text: `Sync failed: ${
            outcome.error ? outcome.error.message : 'unknown error'
          }`,
        });
      }
    });

  const onUpload = () =>
    runAction(async () => {
      const runtime = await startBackgroundSync();
      if (!runtime) {
        setStatus({
          intent: Intent.WARNING,
          text: 'Sync is not configured.',
        });
        return;
      }
      setUploadProgress(null);
      setStatus({
        intent: Intent.PRIMARY,
        text: 'Uploading the data on this device...',
      });
      const result = await uploadAllLocalRecords(runtime.engine, {
        onProgress: (done, total) => setUploadProgress({ done, total }),
      });
      setUploadProgress(null);
      await refreshLastSync();
      setStatus({
        intent: result.stale > 0 ? Intent.WARNING : Intent.SUCCESS,
        text:
          `Uploaded ${result.uploaded} of ${result.total} local record(s)` +
          (result.stale > 0
            ? `; ${result.stale} were already newer on the server.`
            : '.'),
      });
    });

  const onDisconnect = () =>
    runAction(async () => {
      stopBackgroundSync();
      await clearSyncConfig();
      setConfig(null);
      // the same broadcast as above, inverted: "no server" is a config change
      // too, and the console tool must not keep showing an iframe of a server
      // this device is no longer paired with
      sendPubSubMessage(SyncMsg.ConfigChanged, false);
      setLastSyncAt(null);
      setStatus({
        intent: Intent.NONE,
        text: 'Disconnected. Your data stays on this device.',
      });
    });

  // ---- the two tabs (adr/0020) ---------------------------------------------

  /**
   * The setup half, in its two forms. The switch says *where* the server is,
   * not that there are two kinds of pairing: the wizard belongs to the official
   * server, and the form below is the one a server you run has always had.
   */
  const customSetupPanel = (
    <div className={classes.section}>
      <Callout intent={Intent.PRIMARY} title="Pair this browser">
        <p className={classes.pairingHint}>
          Run your own <code>tabversed</code> server, create an account on it,
          then generate a one time pairing code with
          <code> POST /console/api/v1/auth/invites</code> and paste it below.
        </p>
      </Callout>
      <FormGroup label="Server URL" labelFor="sync-url-input">
        <InputGroup
          id="sync-url-input"
          placeholder="https://sync.example.com"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          fill={true}
        />
      </FormGroup>
      <FormGroup label="Pairing code" labelFor="sync-code-input">
        <InputGroup
          id="sync-code-input"
          placeholder="XXXX-XXXX-XXXX-XXXX"
          value={inviteCode}
          onChange={(event) => setInviteCode(event.target.value)}
          fill={true}
        />
      </FormGroup>
      <FormGroup label="Device name" labelFor="sync-device-input">
        <InputGroup
          id="sync-device-input"
          placeholder="chrome"
          value={deviceName}
          onChange={(event) => setDeviceName(event.target.value)}
          fill={true}
        />
      </FormGroup>
      <div className={classes.uploadOption}>
        <Checkbox
          id="sync-upload-input"
          checked={hasLocalData && uploadLocal}
          disabled={!hasLocalData}
          onChange={(event) => setUploadLocal(event.currentTarget.checked)}
          label="Also upload the data already on this device"
        />
        <p className={classes.uploadHint}>
          {hasLocalData && uploadLocal
            ? `This device holds ${localCounts?.total} record(s) ` +
              `(${(localCounts?.byEntity.tabspace || 0).toString()} tabverse(s), ` +
              `${(localCounts?.byEntity.tab || 0).toString()} tab(s)). ` +
              'They are sent to the server once, when you connect.'
            : hasLocalData
              ? 'Your existing data stays on this device. New and changed tabverses still sync from now on.'
              : 'Nothing stored on this device yet, so there is nothing to upload.'}
        </p>
      </div>
      <div className={classes.buttonRow}>
        <Button
          className="tv-primary-button"
          loading={busy}
          text={
            uploadLocal && hasLocalData
              ? 'Pair & upload local data'
              : 'Pair & connect'
          }
          onClick={onPair}
        />
      </div>
    </div>
  );

  const officialSetupPanel = wizardWaiting ? (
    <div className={classes.section}>
      <Callout intent={Intent.PRIMARY} title="Waiting for the Tabverse window">
        <p className={classes.pairingHint}>
          A window opened at <code>{OFFICIAL_PAIR_URL}</code>. Sign in there,
          name this device and allow it - the token comes back on its own, and
          this dialog follows.
        </p>
        <Button
          text="Cancel"
          loading={busy}
          onClick={() => void cancelOfficialWizard()}
        />
      </Callout>
    </div>
  ) : (
    <div className={classes.section}>
      <Callout intent={Intent.SUCCESS} title="Tabverse official server">
        <p className={classes.pairingHint}>
          The server Tabverse runs itself. Sign in with your email (or Google),
          name this device and approve it - there is no code to copy.
        </p>
        <p className={classes.pairingHint}>
          <code>{OFFICIAL_SERVER_URL}</code> - the documentation lives there,
          the console at <code>{OFFICIAL_CONSOLE_URL}</code>
        </p>
      </Callout>
      <div className={classes.buttonRow}>
        <Button
          className="tv-primary-button"
          loading={busy}
          text="Connect with Tabverse"
          onClick={startOfficialWizard}
        />
      </div>
      <p className={classes.pairingHint}>
        Running your own <code>tabversed</code> server? Choose{' '}
        <b>Custom server</b> - it takes a pairing code instead.
      </p>
    </div>
  );

  const statusPanel = config ? (
    <div className={classes.section}>
      <Callout intent={Intent.SUCCESS} title={config.baseUrl}>
        <p className={classes.identity}>
          Device: <code>{config.deviceId || 'unknown'}</code>
          <br />
          Account: <code>{config.userId || 'unknown'}</code>
          <br />
          {syncing ? (
            <Icon
              icon="refresh"
              size={12}
              className="tv-syncing"
              aria-label="Syncing"
            />
          ) : null}
          {lastSyncAt === null ? (
            'Not synced yet'
          ) : (
            <span title={formatDateTime(lastSyncAt)}>
              Last sync: {fromNow(lastSyncAt)}
            </span>
          )}
        </p>
      </Callout>
      <div className={classes.buttonRow}>
        <Button
          className="tv-primary-button"
          loading={busy}
          text="Sync now"
          onClick={onSyncNow}
        />
        <Button
          loading={busy}
          text="Upload local data"
          title="Send everything stored on this device to the server. Setup does this for you unless you untick the box, so this is for later: data created while disconnected, or a retry after a failed upload."
          onClick={onUpload}
        />
        <Button
          intent={Intent.DANGER}
          minimal={true}
          loading={busy}
          text="Disconnect"
          onClick={onDisconnect}
        />
      </div>
    </div>
  ) : (
    <div className={classes.section}>
      <Callout intent={Intent.PRIMARY} title="Not set up yet">
        <p className={classes.pairingHint}>
          Tabverse runs fully local until sync is set up: nothing leaves this
          device.
        </p>
        <Button text="Set up sync" onClick={() => setTab('setup')} />
      </Callout>
    </div>
  );

  // Which server this device is on is a fact the status says out loud, since
  // the setup half offers both ways of getting there.
  const setupLabel = setupLabelOf(config);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Server sync"
      className={classes.dialog}
      canOutsideClickClose={true}
    >
      <DialogBody className={classes.content}>
        {!loaded ? (
          <div className={classes.loadingRow}>
            <Spinner size={20} />
          </div>
        ) : null}

        {loaded ? (
          <Tabs
            id="sync-setup-tabs"
            selectedTabId={tab}
            onChange={(next) => setTab(next as SyncTab)}
            animate={false}
          >
            <Tab id="status" title="Status" panel={statusPanel} />
            <Tab
              id="setup"
              title="Setup"
              panel={
                <div>
                  {config ? (
                    <p className={classes.pairingHint}>
                      Connected to <b>{config.baseUrl}</b> ({setupLabel}).
                      Connecting again replaces this setup.
                    </p>
                  ) : null}
                  <div className={classes.modeRow}>
                    <ButtonGroup fill={true}>
                      <Button
                        active={setupMode === 'official'}
                        text="Tabverse official server"
                        title="Sign in on tabversed.liyu1981.xyz and allow this device"
                        onClick={() => setSetupMode('official')}
                      />
                      <Button
                        active={setupMode === 'custom'}
                        text="Custom server"
                        title="A tabversed server you run yourself, paired with a code"
                        onClick={() => setSetupMode('custom')}
                      />
                    </ButtonGroup>
                  </div>
                  {setupMode === 'official'
                    ? officialSetupPanel
                    : customSetupPanel}
                </div>
              }
            />
          </Tabs>
        ) : null}
        <div className={classes.status}>
          <Callout intent={status.intent}>{status.text}</Callout>
          {uploadProgress ? (
            <p className={classes.uploadProgress}>
              Uploading {uploadProgress.done} of {uploadProgress.total}{' '}
              record(s) ...
            </p>
          ) : null}
        </div>
      </DialogBody>
    </Dialog>
  );
};
