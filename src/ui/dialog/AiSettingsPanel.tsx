/**
 * The Chrome Prompt API section of the settings dialog.
 *
 * Three questions, which are three different answers and are shown as such:
 *
 * - **Can this device use it at all?** (`absent` is the browser or platform
 *   answer, and it is not an error - the features simply do not appear.)
 * - **Is it switched on?** The person's answer, kept per device
 *   (`src/ai/aiSettings.ts`); absent means on.
 * - **Is the local model installed?** The model downloads once per browser, so
 *   the states are "not installed yet", "installing… N%", and "ready". Nothing
 *   downloads until someone asks - the first suggestion or the button here.
 *
 * What it deliberately does not do is hide the section when the API is missing:
 * the settings dialog is where a person looks to find out *why* the wand is not
 * there, so a missing API is exactly what this page should say.
 */
import { Button, Callout, Intent, Switch } from '@blueprintjs/core';
// biome-ignore lint/correctness/noUnusedImports: classic jsx transform needs React in scope (tsconfig "jsx": "react"), TS2686 otherwise
import React, { useCallback, useEffect, useState } from 'react';
import { useSyncExternalStore } from 'react';

import {
  type AiAvailabilityState,
  getAiAvailability,
  probeAiAvailability,
  subscribeAiAvailability,
} from '../../ai/availability';
import {
  getAiEnabled,
  loadAiEnabled,
  setAiEnabled,
  subscribeAiEnabled,
} from '../../ai/aiSettings';
import { NAMING_SYSTEM_PROMPT } from '../../ai/naming';
import { prepareAiModel } from '../../ai/session';
import { logger } from '../../global';
import classes from './AiSettingsPanel.module.scss';

/** "Available on this device" / "Not available in this browser" / … */
function supportText(state: AiAvailabilityState): string {
  switch (state) {
    case 'checking':
      return 'Checking…';
    case 'absent':
      return 'Not available in this browser';
    case 'error':
      return 'Could not check';
    default:
      return 'Available on this device';
  }
}

/** The local model's install state, which is what "downloading" is about. */
function modelText(
  state: AiAvailabilityState,
  progress: number | null,
): string {
  switch (state) {
    case 'checking':
      return 'Checking…';
    case 'absent':
      return 'Not available';
    case 'error':
      return 'Could not check';
    case 'downloadable':
      return 'Not installed yet';
    case 'downloading':
      return progress !== null
        ? `Installing… ${Math.round(progress * 100)}%`
        : 'Installing…';
    case 'ready':
      return 'Installed and ready';
  }
}

export interface AiSettingsViewProps {
  state: AiAvailabilityState;
  progress: number | null;
  /** null until the setting has been read; null is not "off". */
  enabled: boolean | null;
  /** A model load is in flight from this page's button. */
  busy: boolean;
  onToggle: (next: boolean) => void;
  onDownload: () => void;
  onCheck: () => void;
}

/** The section's body, presentational so its shapes can be checked statically. */
export function AiSettingsView(props: AiSettingsViewProps) {
  const { state, progress, enabled, busy } = props;
  const supported = state !== 'absent';
  const intent =
    state === 'ready'
      ? Intent.SUCCESS
      : state === 'absent' || state === 'error'
        ? Intent.WARNING
        : Intent.PRIMARY;

  return (
    <div className={classes.section}>
      <Callout intent={intent} title="Chrome's built-in AI">
        <p className={classes.hint}>
          Name suggestions run on the model Chrome ships with itself (Gemma
          Nano), on this device. Tab titles are handed to it inside the browser
          and are never sent anywhere; no server, no account, nothing to
          configure.
        </p>
      </Callout>

      <Switch
        checked={enabled === true}
        disabled={!supported}
        label="Use the on-device model"
        onChange={(event) => props.onToggle(event.currentTarget.checked)}
      />

      <div className={classes.rows}>
        <div className={classes.row}>
          <span className={classes.label}>Device support</span>
          <span className={classes.value}>{supportText(state)}</span>
        </div>
        <div className={classes.row}>
          <span className={classes.label}>Local model</span>
          <span className={classes.value}>{modelText(state, progress)}</span>
        </div>
        <div className={classes.row}>
          <span className={classes.label}>Offered</span>
          <span className={classes.value}>
            {enabled === null
              ? 'Reading…'
              : enabled
                ? 'Name suggestions are offered'
                : 'Off'}
          </span>
        </div>
      </div>

      <div className={classes.actions}>
        {state === 'downloadable' ? (
          <Button
            intent={Intent.PRIMARY}
            loading={busy}
            text="Download the model now"
            title="Downloads once, on this device; the model is Chrome's own and is not shipped with the extension"
            onClick={props.onDownload}
          />
        ) : null}
        {state === 'downloading' ? (
          <span className={classes.progress}>
            Chrome is downloading the model; this page follows the progress.
          </span>
        ) : null}
        {state === 'error' ? (
          <Button minimal={true} text="Check again" onClick={props.onCheck} />
        ) : null}
      </div>
    </div>
  );
}

export function AiSettingsPanel() {
  const state = useSyncExternalStore(
    subscribeAiAvailability,
    getAiAvailability,
    getAiAvailability,
  );
  const enabled = useSyncExternalStore(
    subscribeAiEnabled,
    getAiEnabled,
    getAiEnabled,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadAiEnabled();
    void probeAiAvailability();
  }, []);

  const onToggle = useCallback((next: boolean) => {
    void setAiEnabled(next);
  }, []);

  const onCheck = useCallback(() => {
    // `error` is the one state a probe does not cache, so this asks again
    void probeAiAvailability();
  }, []);

  const onDownload = useCallback(() => {
    setBusy(true);
    prepareAiModel(NAMING_SYSTEM_PROMPT)
      .catch((err) => {
        logger.log('could not load the on-device model', err);
      })
      .finally(() => {
        setBusy(false);
      });
  }, []);

  return (
    <AiSettingsView
      state={state.state}
      progress={state.progress}
      enabled={enabled}
      busy={busy}
      onToggle={onToggle}
      onDownload={onDownload}
      onCheck={onCheck}
    />
  );
}
