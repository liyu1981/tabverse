import {
  Button,
  Callout,
  ControlGroup,
  Dialog,
  FormGroup,
  InputGroup,
  Intent,
  Spinner,
} from '@blueprintjs/core';
import React, { useEffect, useState } from 'react';

import { logger } from '../../global';
import {
  SyncRuntime,
  startBackgroundSync,
  stopBackgroundSync,
  uploadAllLocalRecords,
} from '../../data/repo/backgroundSync';
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
  }, [isOpen]);

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
      setStatus({
        intent: Intent.SUCCESS,
        text: `Paired with ${cfg.baseUrl}`,
      });
      // start syncing right away (the background worker does the same on its
      // next wake up; both are idempotent)
      await startBackgroundSync();
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
      const uploaded = await uploadAllLocalRecords(runtime.engine);
      setStatus({
        intent: Intent.SUCCESS,
        text: `Uploaded ${uploaded} local record(s) to the server.`,
      });
    });

  const onDisconnect = () =>
    runAction(async () => {
      stopBackgroundSync();
      await clearSyncConfig();
      setConfig(null);
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
      style={{ width: 560 }}
    >
      <div style={{ padding: 20 }}>
        {!loaded ? <Spinner size={20} /> : null}

        {loaded && !config ? (
          <div>
            <Callout intent={Intent.PRIMARY} title="Pair this browser">
              <p>
                Run your own <code>tabversed</code> server, create an account on
                it, then generate a one time pairing code with
                <code> POST /api/v1/auth/invites</code> and paste it below.
              </p>
            </Callout>
            <FormGroup
              label="Server URL"
              labelFor="sync-url-input"
              style={{ marginTop: 12 }}
            >
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
            <ControlGroup fill={true}>
              <Button
                intent={Intent.PRIMARY}
                loading={busy}
                text="Pair & connect"
                onClick={onPair}
              />
            </ControlGroup>
          </div>
        ) : null}

        {loaded && config ? (
          <div>
            <Callout intent={Intent.SUCCESS} title={config.baseUrl}>
              <p>
                Device: <code>{config.deviceId || 'unknown'}</code>
                <br />
                Account: <code>{config.userId || 'unknown'}</code>
              </p>
            </Callout>
            <ControlGroup fill={true} style={{ marginTop: 12 }}>
              <Button
                intent={Intent.PRIMARY}
                loading={busy}
                text="Sync now"
                onClick={onSyncNow}
              />
              <Button
                loading={busy}
                text="Upload local data"
                onClick={onUpload}
              />
              <Button
                intent={Intent.DANGER}
                loading={busy}
                text="Disconnect"
                onClick={onDisconnect}
              />
            </ControlGroup>
          </div>
        ) : null}

        <Callout intent={status.intent} style={{ marginTop: 12 }}>
          {status.text}
        </Callout>
      </div>
    </Dialog>
  );
};
