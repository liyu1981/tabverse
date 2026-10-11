/**
 * The tab suspension section of the settings dialog.
 *
 * Two controls and the plain-language sentence that says what they do: whether
 * inactive tabs are unloaded at all, and after how long. A suspended tab is
 * not a closed one - it stays in the strip and reloads when opened - so the
 * copy says that rather than leaving the word to carry the fear.
 *
 * The threshold is read as a number and written back through the module's
 * clamp, so a typed `1` becomes the five-minute floor instead of a sweep that
 * fires almost immediately.
 */
import { Callout, NumericInput, Switch } from '@blueprintjs/core';
// biome-ignore lint/correctness/noUnusedImports: classic jsx transform needs React in scope (tsconfig "jsx": "react"), TS2686 otherwise
import React, { useCallback, useEffect } from 'react';
import { useSyncExternalStore } from 'react';

import {
  MAX_SUSPEND_AFTER_MINUTES,
  MIN_SUSPEND_AFTER_MINUTES,
  getSuspendSettings,
  loadSuspendSettings,
  setSuspendAfterMinutes,
  setSuspendEnabled,
  subscribeSuspendSettings,
} from '../../data/tabSpace/suspendSettings';
import classes from './SuspendSettingsPanel.module.scss';

export interface SuspendSettingsViewProps {
  /** null until the setting has been read; null is not "off". */
  enabled: boolean | null;
  afterMinutes: number | null;
  onToggle: (next: boolean) => void;
  onChangeMinutes: (next: number) => void;
}

/** The one sentence that restates the two controls in plain language. */
export function suspendSummary(
  enabled: boolean | null,
  afterMinutes: number | null,
): string {
  if (enabled === null) {
    return 'Reading…';
  }
  if (!enabled) {
    return 'Suspension is off. No tab is unloaded.';
  }
  return `Tabs left alone for more than ${
    afterMinutes ?? 0
  } minutes are unloaded; opening one reloads it.`;
}

/** The section's body, presentational so its shapes can be checked statically. */
export function SuspendSettingsView(props: SuspendSettingsViewProps) {
  const { enabled, afterMinutes } = props;
  return (
    <div className={classes.section}>
      <Callout title="Suspending inactive tabs">
        <p className={classes.hint}>
          A suspended tab is unloaded from memory but stays in the tab strip.
          Opening it again reloads the page; nothing is closed. Tabverse only
          suspends tabs in a window that has a tabverse open, and never one you
          whitelist, pin, or are listening to.
        </p>
      </Callout>

      <Switch
        checked={enabled === true}
        label="Suspend inactive tabs"
        onChange={(event) => props.onToggle(event.currentTarget.checked)}
      />

      <div className={classes.row}>
        <span className={classes.label}>Suspend after</span>
        <div className={classes.control}>
          <NumericInput
            className={classes.minutes}
            fill={false}
            value={afterMinutes ?? ''}
            min={MIN_SUSPEND_AFTER_MINUTES}
            max={MAX_SUSPEND_AFTER_MINUTES}
            stepSize={5}
            minorStepSize={1}
            disabled={enabled !== true || afterMinutes === null}
            onValueChange={(value) => {
              if (Number.isFinite(value)) {
                props.onChangeMinutes(value);
              }
            }}
          />
          <span className={classes.unit}>minutes</span>
        </div>
      </div>

      <p className={classes.hint}>{suspendSummary(enabled, afterMinutes)}</p>
    </div>
  );
}

export function SuspendSettingsPanel() {
  const settings = useSyncExternalStore(
    subscribeSuspendSettings,
    getSuspendSettings,
    getSuspendSettings,
  );

  useEffect(() => {
    void loadSuspendSettings();
  }, []);

  const onToggle = useCallback((next: boolean) => {
    void setSuspendEnabled(next);
  }, []);

  const onChangeMinutes = useCallback((next: number) => {
    void setSuspendAfterMinutes(next);
  }, []);

  return (
    <SuspendSettingsView
      enabled={settings.enabled}
      afterMinutes={settings.afterMinutes}
      onToggle={onToggle}
      onChangeMinutes={onChangeMinutes}
    />
  );
}
