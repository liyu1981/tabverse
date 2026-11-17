import { IBase } from '../common';
import { inPlaceConvertToSaved, newEmptyBase } from '../Base';
import { safeIconUrl } from './icon';

import { produce } from 'immer';

/**
 * A shortcut: a page a person launches from the Launchpad.
 *
 * Unlike a Bookmark this belongs to **no tabverse**. There is no
 * `tabSpaceId`, no per-tabverse aggregate and no ordering row: a shortcut is
 * saved once and is available from every tabverse in every window
 * (`doc/tabverse-shortcuts-plan.md`, and the ADR it proposes). Its identity is
 * still an ordinary record id, because a url is not an identity - the same
 * page can be saved twice on two devices before either one syncs.
 *
 * The logo is stored as bytes (`iconDataUrl`) so a tile survives a site that
 * blocks hotlinking, deletes its icon, or is simply offline on the device the
 * Launchpad is opened on. `iconUrl` is the source it was fetched from (the
 * fallback chain and the thing a future refresh would re-fetch), and
 * `favIconUrl` is the tab's own small icon (the last url fallback).
 */
export interface Shortcut extends IBase {
  name: string;
  /** Normalized absolute http(s) url, no fragment. */
  url: string;
  /** The stored logo, a `data:image/...` string; '' when none could be made. */
  iconDataUrl: string;
  /** Where the logo came from, when it was a page url; '' for none. */
  iconUrl: string;
  /** The page's own favicon url, the last fallback before the monogram. */
  favIconUrl: string;
}

export const SHORTCUT_DB_TABLE_NAME = 'SavedShortcut';
/**
 * `url` is indexed for the duplicate check ("already in the Launchpad"), and
 * `createdAt` for the newest-first order. Rows are keyed by `id`.
 */
export const SHORTCUT_DB_SCHEMA = 'id, createdAt, url';

/**
 * How the Launchpad is ordered. Window-local (see the view), so it is a string
 * in localStorage rather than anything on the record.
 */
export const SHORTCUT_ORDER_ALPHABETICAL = 'alphabetical';
export const SHORTCUT_ORDER_NEWEST = 'newest';
export type ShortcutOrder =
  | typeof SHORTCUT_ORDER_ALPHABETICAL
  | typeof SHORTCUT_ORDER_NEWEST;

/** What a row's source tells us, before the logo has been fetched. */
export interface ShortcutPage {
  name?: string;
  url: string;
  favIconUrl?: string;
}

export interface ShortcutIconData {
  iconDataUrl?: string;
  iconUrl?: string;
}

export function newEmptyShortcut(): Shortcut {
  return {
    ...newEmptyBase(),
    name: '',
    url: '',
    iconDataUrl: '',
    iconUrl: '',
    favIconUrl: '',
  };
}

/**
 * The url a shortcut is identified by, or '' when it cannot be a shortcut.
 *
 * Only http(s) survives: a `chrome://` page, a `file://` path or an extension
 * page cannot be opened from another device (and a `javascript:` url must
 * never be stored at all). The fragment is dropped, because it names a place
 * inside the page rather than the page, and `new URL` already folds an empty
 * path to `/`, so `https://example.com` and `https://example.com/` are one
 * shortcut. Everything else about the url is kept: a query string can be the
 * whole tool (`?doc=...`).
 */
export function normalizeShortcutUrl(raw: string): string {
  const text = String(raw ?? '').trim();
  if (text.length <= 0) {
    return '';
  }
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return '';
  }
  parsed.hash = '';
  return parsed.href;
}

/** Whether a url can be a shortcut at all (the same rule, as a predicate). */
export function isShortcutableUrl(url: string): boolean {
  return normalizeShortcutUrl(url).length > 0;
}

/** The host without `www.`, for a name fallback and the monogram colour. */
export function shortcutHostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/** The name shown on a tile: the stored one, or the site's host. */
export function shortcutDisplayName(
  shortcut: Pick<Shortcut, 'name' | 'url'>,
): string {
  const name = String(shortcut.name ?? '').trim();
  return name.length > 0 ? name : shortcutHostOf(shortcut.url);
}

/**
 * Builds a saved shortcut from a page. Null when the url is not one a shortcut
 * can hold (see `normalizeShortcutUrl`).
 */
export function shortcutFromPage(
  page: ShortcutPage,
  icon: ShortcutIconData = {},
): Shortcut | null {
  const url = normalizeShortcutUrl(page.url);
  if (url.length <= 0) {
    return null;
  }
  const name =
    String(page.name ?? '').trim().length > 0
      ? String(page.name).trim()
      : shortcutHostOf(url);
  return convertToSavedShortcut(
    produce(newEmptyShortcut(), (draft) => {
      draft.name = name;
      draft.url = url;
      draft.iconDataUrl = icon.iconDataUrl ?? '';
      draft.iconUrl = icon.iconUrl ?? '';
      // the same rule the renderer applies: only http(s) or a data image
      draft.favIconUrl = safeIconUrl(page.favIconUrl ?? '');
    }),
  );
}

export function convertToSavedShortcut(shortcut: Shortcut): Shortcut {
  return produce(shortcut, (draft) => {
    inPlaceConvertToSaved(draft);
  });
}

const NAME_COLLATOR = new Intl.Collator(undefined, {
  sensitivity: 'base',
  numeric: true,
});

function compareText(a: string, b: string): number {
  return NAME_COLLATOR.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * The list in the requested order.
 *
 * Alphabetical is a launchpad's default: a grid is scanned by name, and a
 * launchpad that reorders itself is harder to learn than one that does not.
 * Newest-first is the other half of the same idea - it is what makes a tile
 * that was just added obvious. Both end with the url as a tiebreak so two
 * entries with the same name never swap places between renders.
 */
export function orderShortcuts(
  shortcuts: readonly Shortcut[],
  order: ShortcutOrder,
): Shortcut[] {
  const out = shortcuts.slice();
  if (order === SHORTCUT_ORDER_NEWEST) {
    out.sort(
      (a, b) =>
        b.createdAt - a.createdAt ||
        compareText(shortcutDisplayName(a), shortcutDisplayName(b)) ||
        compareText(a.url, b.url),
    );
    return out;
  }
  out.sort(
    (a, b) =>
      compareText(shortcutDisplayName(a), shortcutDisplayName(b)) ||
      compareText(a.url, b.url),
  );
  return out;
}

/** The shortcut in a list with this url, if there is one. */
export function shortcutWithUrl<T extends Pick<Shortcut, 'url'>>(
  shortcuts: readonly T[],
  url: string,
): T | undefined {
  const normalized = normalizeShortcutUrl(url);
  if (normalized.length <= 0) {
    return undefined;
  }
  return shortcuts.find((shortcut) => shortcut.url === normalized);
}

/** Pure list operations, so the store and its tests do not need the database. */
export function upsertShortcut<T extends Shortcut>(
  shortcuts: readonly T[],
  shortcut: T,
): T[] {
  const out = shortcuts.filter((item) => item.id !== shortcut.id);
  out.push(shortcut);
  return out;
}

export function removeShortcut<T extends Shortcut>(
  shortcuts: readonly T[],
  id: string,
): T[] {
  return shortcuts.filter((item) => item.id !== id);
}
