import {
  Button,
  ButtonGroup,
  Callout,
  Checkbox,
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
import { t } from '../../i18n';
import { formatDateTime, fromNow } from '../../time';
import classes from './ServerSyncPanel.module.scss';
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
    ? t('syncLabelOfficial')
    : t('syncLabelCustom');
}

interface IStatus {
  intent: Intent;
  text: string;
}

const NOT_CONNECTED: IStatus = {
  intent: Intent.NONE,
  text: t('syncNotConnected'),
};

export const ServerSyncPanel = () => {
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
    // mounted is open: the settings dialog renders this panel only while its
    // Sync tab is the active one, so there is no `isOpen` to watch
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
            text: t('syncConnectedTo', [cfg.baseUrl]),
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
  }, [refreshLastSync]);

  // The worker is what takes the token from the wizard page (adr/0020): it is
  // the context that is always there, and it owns the config. This page is the
  // one watching, so it redraws as connected when that happens, and closes the
  // window it opened - the wizard has already said it can be closed.
  useEffect(() => {
    const token = subscribePubSubMessage(SyncMsg.ConfigChanged, () => {
      void loadSyncConfig()
        .then(async (cfg) => {
          if (!cfg) return;
          setConfig(cfg);
          setTab('status');
          setStatus({
            intent: Intent.SUCCESS,
            text: t('syncConnectedTo', [cfg.baseUrl]),
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
  }, [refreshLastSync]);

  const runAction = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err: any) {
      setStatus({
        intent: Intent.DANGER,
        text: t('syncFailedTo', [
          err && err.message ? err.message : String(err),
        ]),
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
        text: t('syncWizardOpened'),
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
          text: t('syncBothRequired'),
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
          text: t('syncPairedNoUpload', [cfg.baseUrl]),
        });
        return;
      }
      if (!runtime) {
        setStatus({
          intent: Intent.WARNING,
          text: t('syncPairedUploadSkipped', [cfg.baseUrl]),
        });
        return;
      }

      // Pairing already succeeded at this point, so an upload failure is
      // reported as a failure of the upload and nothing else: the device is
      // paired, the local copy is intact, and the button can retry.
      try {
        setStatus({
          intent: Intent.PRIMARY,
          text: t('syncPairedUploading', [cfg.baseUrl]),
        });
        const result = await uploadAllLocalRecords(runtime.engine, {
          onProgress: (done, total) => setUploadProgress({ done, total }),
        });
        setUploadProgress(null);
        setStatus({
          intent: result.stale > 0 ? Intent.WARNING : Intent.SUCCESS,
          text:
            result.stale > 0
              ? t('syncPairedUploadDoneStale', [
                  cfg.baseUrl,
                  String(result.uploaded),
                  String(result.total),
                  String(result.stale),
                ])
              : t('syncPairedUploadDoneNoStale', [
                  cfg.baseUrl,
                  String(result.uploaded),
                  String(result.total),
                ]),
        });
      } catch (err: any) {
        setUploadProgress(null);
        setStatus({
          intent: Intent.WARNING,
          text: t('syncPairedUploadFailed', [
            cfg.baseUrl,
            err && err.message ? err.message : String(err),
          ]),
        });
      }
    });

  const onSyncNow = () =>
    runAction(async () => {
      const runtime: SyncRuntime | null = await startBackgroundSync();
      if (!runtime) {
        setStatus({
          intent: Intent.WARNING,
          text: t('syncNotConfigured'),
        });
        return;
      }
      const outcome = await runtime.syncNow();
      await refreshLastSync();
      if (outcome.status === 'ok') {
        setStatus({
          intent: Intent.SUCCESS,
          text:
            outcome.stale > 0
              ? t('syncSyncedStale', [
                  String(outcome.pushed),
                  String(outcome.pulled),
                  String(outcome.stale),
                ])
              : t('syncSyncedNoStale', [
                  String(outcome.pushed),
                  String(outcome.pulled),
                ]),
        });
      } else if (outcome.status === 'error') {
        setStatus({
          intent: Intent.DANGER,
          text: t('syncSyncFailed', [
            outcome.error ? outcome.error.message : t('syncUnknownError'),
          ]),
        });
      }
    });

  const onUpload = () =>
    runAction(async () => {
      const runtime = await startBackgroundSync();
      if (!runtime) {
        setStatus({
          intent: Intent.WARNING,
          text: t('syncNotConfigured'),
        });
        return;
      }
      setUploadProgress(null);
      setStatus({
        intent: Intent.PRIMARY,
        text: t('syncUploadingNow'),
      });
      const result = await uploadAllLocalRecords(runtime.engine, {
        onProgress: (done, total) => setUploadProgress({ done, total }),
      });
      setUploadProgress(null);
      await refreshLastSync();
      setStatus({
        intent: result.stale > 0 ? Intent.WARNING : Intent.SUCCESS,
        text:
          result.stale > 0
            ? t('syncUploadDoneStale', [
                String(result.uploaded),
                String(result.total),
                String(result.stale),
              ])
            : t('syncUploadDoneNoStale', [
                String(result.uploaded),
                String(result.total),
              ]),
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
        text: t('syncDisconnected'),
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
      <Callout intent={Intent.PRIMARY} title={t('syncPairCalloutTitle')}>
        <p className={classes.pairingHint}>
          {t('syncPairHint1')}
          <code>tabversed</code>
          {t('syncPairHint2')}
          <code> POST /console/api/v1/auth/invites</code>
          {t('syncPairHint3')}
        </p>
      </Callout>
      <FormGroup label={t('syncServerUrlLabel')} labelFor="sync-url-input">
        <InputGroup
          id="sync-url-input"
          placeholder={t('syncServerUrlPlaceholder')}
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          fill={true}
        />
      </FormGroup>
      <FormGroup label={t('syncPairingCodeLabel')} labelFor="sync-code-input">
        <InputGroup
          id="sync-code-input"
          placeholder={t('syncPairingCodePlaceholder')}
          value={inviteCode}
          onChange={(event) => setInviteCode(event.target.value)}
          fill={true}
        />
      </FormGroup>
      <FormGroup label={t('syncDeviceNameLabel')} labelFor="sync-device-input">
        <InputGroup
          id="sync-device-input"
          placeholder={t('syncDeviceNamePlaceholder')}
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
          label={t('syncUploadLocalLabel')}
        />
        <p className={classes.uploadHint}>
          {hasLocalData && uploadLocal
            ? t('syncUploadHintCount', [
                String(localCounts?.total ?? 0),
                String(localCounts?.byEntity.tabspace || 0),
                String(localCounts?.byEntity.tab || 0),
              ])
            : hasLocalData
              ? t('syncUploadHintStays')
              : t('syncUploadHintNothing')}
        </p>
      </div>
      <div className={classes.buttonRow}>
        <Button
          className="tv-primary-button"
          loading={busy}
          text={
            uploadLocal && hasLocalData
              ? t('syncPairUploadButton')
              : t('syncPairConnectButton')
          }
          onClick={onPair}
        />
      </div>
    </div>
  );

  const officialSetupPanel = wizardWaiting ? (
    <div className={classes.section}>
      <Callout intent={Intent.PRIMARY} title={t('syncWaitingTitle')}>
        <p className={classes.pairingHint}>
          {t('syncWaitingHint1')}
          <code>{OFFICIAL_PAIR_URL}</code>
          {t('syncWaitingHint2')}
        </p>
        <Button
          text={t('commonCancel')}
          loading={busy}
          onClick={() => void cancelOfficialWizard()}
        />
      </Callout>
    </div>
  ) : (
    <div className={classes.section}>
      <Callout intent={Intent.SUCCESS} title={t('syncLabelOfficial')}>
        <p className={classes.pairingHint}>{t('syncOfficialHint1')}</p>
        <p className={classes.pairingHint}>
          <code>{OFFICIAL_SERVER_URL}</code>
          {t('syncOfficialHint2')}
          <code>{OFFICIAL_CONSOLE_URL}</code>
        </p>
      </Callout>
      <div className={classes.buttonRow}>
        <Button
          className="tv-primary-button"
          loading={busy}
          text={t('syncConnectOfficialButton')}
          onClick={startOfficialWizard}
        />
      </div>
      <p className={classes.pairingHint}>
        {t('syncOwnServerHint1')}
        <code>tabversed</code>
        {t('syncOwnServerHint2')}
        <b>{t('syncCustomServerMode')}</b>
        {t('syncOwnServerHint3')}
      </p>
    </div>
  );

  const statusPanel = config ? (
    <div className={classes.section}>
      <Callout intent={Intent.SUCCESS} title={config.baseUrl}>
        <p className={classes.identity}>
          {t('syncDeviceLabel')}
          <code>{config.deviceId || t('syncUnknown')}</code>
          <br />
          {t('syncAccountLabel')}
          <code>{config.userId || t('syncUnknown')}</code>
          <br />
          {syncing ? (
            <Icon
              icon="refresh"
              size={12}
              className="tv-syncing"
              aria-label={t('syncSyncingAria')}
            />
          ) : null}
          {lastSyncAt === null ? (
            t('syncNotSyncedYet')
          ) : (
            <span title={formatDateTime(lastSyncAt)}>
              {t('syncLastSyncLabel')}
              {fromNow(lastSyncAt)}
            </span>
          )}
        </p>
      </Callout>
      <div className={classes.buttonRow}>
        <Button
          className="tv-primary-button"
          loading={busy}
          text={t('syncNowButton')}
          onClick={onSyncNow}
        />
        <Button
          loading={busy}
          text={t('syncUploadLocalButton')}
          title={t('syncUploadLocalTitle')}
          onClick={onUpload}
        />
        <Button
          intent={Intent.DANGER}
          minimal={true}
          loading={busy}
          text={t('syncDisconnectButton')}
          onClick={onDisconnect}
        />
      </div>
    </div>
  ) : (
    <div className={classes.section}>
      <Callout intent={Intent.PRIMARY} title={t('syncNotSetUpTitle')}>
        <p className={classes.pairingHint}>{t('syncNotSetUpHint')}</p>
        <Button text={t('syncSetUpButton')} onClick={() => setTab('setup')} />
      </Callout>
    </div>
  );

  // Which server this device is on is a fact the status says out loud, since
  // the setup half offers both ways of getting there.
  const setupLabel = setupLabelOf(config);

  return (
    <div className={classes.content}>
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
          <Tab id="status" title={t('syncTabStatus')} panel={statusPanel} />
          <Tab
            id="setup"
            title={t('syncTabSetup')}
            panel={
              <div>
                {config ? (
                  <p className={classes.pairingHint}>
                    {t('syncConnectedToSetup1')}
                    <b>{config.baseUrl}</b>
                    {t('syncConnectedToSetup2', [setupLabel])}
                  </p>
                ) : null}
                <div className={classes.modeRow}>
                  <ButtonGroup fill={true}>
                    <Button
                      active={setupMode === 'official'}
                      text={t('syncLabelOfficial')}
                      title={t('syncOfficialModeTitle')}
                      onClick={() => setSetupMode('official')}
                    />
                    <Button
                      active={setupMode === 'custom'}
                      text={t('syncCustomServerMode')}
                      title={t('syncCustomModeTitle')}
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
            {t('syncUploadingProgress', [
              String(uploadProgress.done),
              String(uploadProgress.total),
            ])}
          </p>
        ) : null}
      </div>
    </div>
  );
};
