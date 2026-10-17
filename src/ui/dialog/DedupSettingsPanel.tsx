/**
 * The duplicate-tab advisor section of the settings dialog.
 *
 * A switch and a scan interval. The copy is emphatic that this is an advisor:
 * it only looks, and tabs are closed by a person, never by the scan. The
 * threshold is read as a number and written through the module's clamp, so a
 * typed `0` becomes the one-minute floor.
 */
import { Callout, NumericInput, Switch } from '@blueprintjs/core';
import React, { useCallback, useEffect, useSyncExternalStore } from 'react';

import {
  MAX_DEDUP_SCAN_MINUTES,
  MIN_DEDUP_SCAN_MINUTES,
  getDedupSettings,
  loadDedupSettings,
  setDedupEnabled,
  setDedupScanMinutes,
  subscribeDedupSettings,
} from '../../data/tabSpace/dedupSettings';
import classes from './DedupSettingsPanel.module.scss';

export interface DedupSettingsViewProps {
  /** null until the setting has been read; null is not "off". */
  enabled: boolean | null;
  minutes: number | null;
  onToggle: (next: boolean) => void;
  onChangeMinutes: (next: number) => void;
}

/** The one sentence that restates the two controls in plain language. */
export function dedupSummary(
  enabled: boolean | null,
  minutes: number | null,
): string {
  if (enabled === null) {
    return 'Reading…';
  }
  if (!enabled) {
    return 'The duplicate advisor is off. No tab is looked at.';
  }
  return `Open tabs are checked every ${
    minutes ?? 0
  } minutes; duplicates are offered for removal, never closed on their own.`;
}

/** The section's body, presentational so its shapes can be checked statically. */
export function DedupSettingsView(props: DedupSettingsViewProps) {
  const { enabled, minutes } = props;
  return (
    <div className={classes.section}>
      <Callout title="Duplicate tabs">
        <p className={classes.hint}>
          The advisor only looks. When it finds two open tabs on the same page
          in a window with a tabverse, the tab list shows a notice where you can
          close the extras or ignore them. It never closes a tab by itself, and
          never touches a pinned tab or one that is playing audio.
        </p>
      </Callout>

      <Switch
        checked={enabled !== false}
        label="Find duplicate tabs"
        onChange={(event) => props.onToggle(event.currentTarget.checked)}
      />

      <div className={classes.row}>
        <span className={classes.label}>Check every</span>
        <div className={classes.control}>
          <NumericInput
            className={classes.minutes}
            fill={false}
            value={minutes ?? ''}
            min={MIN_DEDUP_SCAN_MINUTES}
            max={MAX_DEDUP_SCAN_MINUTES}
            stepSize={5}
            minorStepSize={1}
            disabled={enabled === false || minutes === null}
            onValueChange={(value) => {
              if (Number.isFinite(value)) {
                props.onChangeMinutes(value);
              }
            }}
          />
          <span className={classes.unit}>minutes</span>
        </div>
      </div>

      <p className={classes.hint}>{dedupSummary(enabled, minutes)}</p>
    </div>
  );
}

export function DedupSettingsPanel() {
  const settings = useSyncExternalStore(
    subscribeDedupSettings,
    getDedupSettings,
    getDedupSettings,
  );

  useEffect(() => {
    void loadDedupSettings();
  }, []);

  const onToggle = useCallback((next: boolean) => {
    void setDedupEnabled(next);
  }, []);

  const onChangeMinutes = useCallback((next: number) => {
    void setDedupScanMinutes(next);
  }, []);

  return (
    <DedupSettingsView
      enabled={settings.enabled}
      minutes={settings.minutes}
      onToggle={onToggle}
      onChangeMinutes={onChangeMinutes}
    />
  );
}
