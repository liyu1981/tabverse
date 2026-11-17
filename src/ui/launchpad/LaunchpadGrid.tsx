import { Button } from '@blueprintjs/core';
import React, { useState } from 'react';

import { t } from '../../i18n';
import {
  Shortcut,
  normalizeShortcutUrl,
  shortcutDisplayName,
  shortcutHostOf,
} from '../../data/shortcut/Shortcut';
import { iconColorOf, monogramOf, safeIconUrl } from '../../data/shortcut/icon';
import classes from './Launchpad.module.scss';

/**
 * The urls a tile may draw, in order: bytes, the source, the favicon.
 *
 * Every one is re-checked here, not trusted from the record: `iconDataUrl` can
 * come from another device (a hostile one can put anything in a payload), and
 * a `javascript:` or an enormous `data:` string must never reach an `<img>`.
 */
export function iconSourcesOf(shortcut: Shortcut): string[] {
  return [shortcut.iconDataUrl, shortcut.iconUrl, shortcut.favIconUrl]
    .map((source) => safeIconUrl(source ?? ''))
    .filter((source) => source.length > 0);
}

/**
 * A shortcut's picture, or its monogram.
 *
 * `onError` is what makes the fallback chain real: a stored data url is always
 * there, but a row synced from a device that stored a source url instead may
 * still point at a site that removed the file. When every source has failed
 * the tile keeps its shape with the first letter of the name.
 */
export function ShortcutIcon(props: { shortcut: Shortcut }) {
  const sources = iconSourcesOf(props.shortcut);
  const [index, setIndex] = useState(0);
  const source = sources[index];

  if (source === undefined) {
    const name = shortcutDisplayName(props.shortcut);
    return (
      <span
        className={classes.monogram}
        style={{
          backgroundColor: iconColorOf(
            shortcutHostOf(props.shortcut.url) || name,
          ),
        }}
        aria-hidden={true}
      >
        {monogramOf(name)}
      </span>
    );
  }
  return (
    <img
      className={classes.icon}
      src={source}
      alt=""
      aria-hidden={true}
      onError={() => setIndex((current) => current + 1)}
    />
  );
}

export interface LaunchpadGridProps {
  shortcuts: Shortcut[];
  /** How many shortcuts exist before the filter; 0 is the empty Launchpad. */
  total: number;
  /** Whether the box currently has text in it, for the no-match message. */
  filtering: boolean;
  onDelete: (shortcut: Shortcut) => void;
}

/**
 * The tiles themselves, presentational so `renderToStaticMarkup` can pin the
 * shape without a browser (AGENTS.md). The link is an anchor rather than a
 * button on purpose: `target="_blank"` gives click, middle-click, Ctrl-click
 * and the browser's own "open in new tab" menu for free, and the delete button
 * is a sibling because a button inside an anchor is nested interactive
 * content.
 */
export function LaunchpadGrid(props: LaunchpadGridProps) {
  if (props.total <= 0) {
    return <div className={classes.notice}>{t('launchpadEmpty')}</div>;
  }
  if (props.shortcuts.length <= 0) {
    return (
      <div className={classes.notice}>
        {props.filtering ? t('launchpadNoMatch') : t('launchpadEmpty')}
      </div>
    );
  }
  return (
    <ul className={classes.grid}>
      {props.shortcuts.map((shortcut) => {
        const name = shortcutDisplayName(shortcut);
        // a row synced from a hostile device can carry any scheme; only a
        // real http(s) page becomes a link
        const href = normalizeShortcutUrl(shortcut.url);
        if (href.length <= 0) {
          return null;
        }
        return (
          <li key={shortcut.id} className={classes.tile}>
            <a
              className={classes.tileLink}
              href={href}
              target="_blank"
              rel="noreferrer"
              title={name}
            >
              {/* the key restarts the fallback chain when a backfilled icon
                  changes the sources; without it a tile that had fallen back
                  to its monogram would stay there after the bytes arrived */}
              <ShortcutIcon
                key={`${shortcut.id}:${shortcut.iconDataUrl.length}:${shortcut.iconUrl.length}:${shortcut.favIconUrl.length}`}
                shortcut={shortcut}
              />
              <span className={classes.tileName}>{name}</span>
            </a>
            <Button
              className={classes.tileDelete}
              icon="trash"
              minimal={true}
              small={true}
              title={t('launchpadDeleteNamed', [name])}
              aria-label={t('launchpadDeleteNamed', [name])}
              onClick={() => props.onDelete(shortcut)}
            />
          </li>
        );
      })}
    </ul>
  );
}
