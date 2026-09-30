import {
  Button,
  Callout,
  Checkbox,
  Dialog,
  DialogBody,
  FormGroup,
  Icon,
  InputGroup,
  Intent,
  Spinner,
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
      setLastSyncAt(null);
      setStatus({
        intent: Intent.NONE,
        text: 'Disconnected. Your data stays on this device.',
      });
    });

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

        {loaded && !config ? (
          <div className={classes.section}>
            <Callout intent={Intent.PRIMARY} title="Pair this browser">
              <p className={classes.pairingHint}>
                Run your own <code>tabversed</code> server, create an account on
                it, then generate a one time pairing code with
                <code> POST /api/v1/auth/invites</code> and paste it below.
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
                onChange={(event) =>
                  setUploadLocal(event.currentTarget.checked)
                }
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
        ) : null}

        {loaded && config ? (
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
