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
import { t } from '../../i18n';
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
    return t('commonReading');
  }
  if (!enabled) {
    return t('dedupOffSummary');
  }
  return t('dedupOnSummary', [String(minutes ?? 0)]);
}

/** The section's body, presentational so its shapes can be checked statically. */
export function DedupSettingsView(props: DedupSettingsViewProps) {
  const { enabled, minutes } = props;
  return (
    <div className={classes.section}>
      <Callout title={t('dedupCalloutTitle')}>
        <p className={classes.hint}>{t('dedupHint')}</p>
      </Callout>

      <Switch
        checked={enabled !== false}
        label={t('dedupSwitchLabel')}
        onChange={(event) => props.onToggle(event.currentTarget.checked)}
      />

      <div className={classes.row}>
        <span className={classes.label}>{t('dedupCheckEveryLabel')}</span>
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
          <span className={classes.unit}>{t('commonMinutes')}</span>
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
