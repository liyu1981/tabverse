/**
 * The appearance section of the settings dialog: the sidebar's colour.
 *
 * The rail is the app's one dark surface with near-white glyphs on it, so the
 * panel offers dark swatches only (see `data/tabSpace/sidebarColor.ts`, whose
 * test is what keeps them legible). The colour is the tabverse's, not the
 * device's - it follows the window and travels with the tabverse - and the one
 * switch here is a device preference for what the *next* tabverse looks like.
 *
 * Presentational split, as everywhere in this dialog: `AppearanceSettingsView`
 * is the markup a static render can see, and the container supplies the store
 * and the storage reads.
 */
import { Callout, Switch } from '@blueprintjs/core';
import clsx from 'clsx';
import React, { useCallback, useEffect } from 'react';
import { useSyncExternalStore } from 'react';
import { useStore } from 'effector-react';

import {
  SIDEBAR_COLORS,
  resolveSidebarColor,
} from '../../data/tabSpace/sidebarColor';
import {
  getSidebarRandomOnCreate,
  loadSidebarRandomOnCreate,
  setSidebarRandomOnCreate,
  subscribeSidebarRandomOnCreate,
} from '../../data/tabSpace/sidebarColorSettings';
import { $tabSpace, tabSpaceStoreApi } from '../../data/tabSpace/store';
import { saveCurrentTabSpaceNow } from '../../data/tabSpace/util';
import classes from './AppearanceSettingsPanel.module.scss';

export interface AppearanceSettingsViewProps {
  /** the current tabverse's colour (already resolved to a palette hex) */
  color: string;
  /** null until the preference has been read; null is not "off" */
  randomOnCreate: boolean | null;
  onPickColor: (hex: string) => void;
  onToggleRandom: (next: boolean) => void;
}

/** The one sentence that says what the switch does in plain language. */
export function randomColorSummary(randomOnCreate: boolean | null): string {
  if (randomOnCreate === null) {
    return 'Reading…';
  }
  return randomOnCreate
    ? 'A new tabverse rolls a colour from this palette.'
    : 'A new tabverse starts with the default colour.';
}

/** The section's body, presentational so its shapes can be checked statically. */
export function AppearanceSettingsView(props: AppearanceSettingsViewProps) {
  return (
    <div className={classes.section}>
      <Callout title="Sidebar colour">
        <p className={classes.hint}>
          The rail carries near-white glyphs - the logo, the caption, the icons
          in the bar at the bottom - so the choices here are all dark. The
          colour belongs to the tabverse in this window: it follows the window,
          and it travels with the tabverse.
        </p>
      </Callout>

      <div className={classes.swatches}>
        {SIDEBAR_COLORS.map((color) => {
          const chosen = color.hex === props.color;
          return (
            <button
              key={color.hex}
              type="button"
              className={clsx(classes.swatch, chosen && classes.swatchChosen)}
              style={{ backgroundColor: color.hex }}
              aria-label={color.name}
              aria-pressed={chosen}
              title={color.name}
              onClick={() => props.onPickColor(color.hex)}
            />
          );
        })}
      </div>

      <Switch
        checked={props.randomOnCreate === true}
        label="Use a random colour for a new tabverse"
        onChange={(event) => props.onToggleRandom(event.currentTarget.checked)}
      />

      <p className={classes.hint}>{randomColorSummary(props.randomOnCreate)}</p>
    </div>
  );
}

export function AppearanceSettingsPanel() {
  const tabSpace = useStore($tabSpace);
  const randomOnCreate = useSyncExternalStore(
    subscribeSidebarRandomOnCreate,
    getSidebarRandomOnCreate,
    getSidebarRandomOnCreate,
  );

  useEffect(() => {
    void loadSidebarRandomOnCreate();
  }, []);

  const onPickColor = useCallback((hex: string) => {
    tabSpaceStoreApi.updateTabSpace({ color: hex });
    // the colour is tabverse data and is expected to survive a reload, so it
    // is written now rather than on the autosave's debounce
    void saveCurrentTabSpaceNow();
    // a *new* tabverse's colour lives in the url too (see `tabverseUrl`), and
    // a reload rebuilds the in-memory tabverse from the url + the live window;
    // without this a colour picked after creation would not survive it
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('color', hex);
      window.history.replaceState({}, '', url);
    }
  }, []);

  const onToggleRandom = useCallback((next: boolean) => {
    void setSidebarRandomOnCreate(next);
  }, []);

  return (
    <AppearanceSettingsView
      color={resolveSidebarColor(tabSpace.color)}
      randomOnCreate={randomOnCreate}
      onPickColor={onPickColor}
      onToggleRandom={onToggleRandom}
    />
  );
}
