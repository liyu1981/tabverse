/**
 * The one add path: a page (live tab or a stored row) becomes a shortcut.
 *
 * The four entry points (tab list, Bookmark, History, toolbar popup) all come
 * through here, so "is this page already saved?", "which icon?", and "what is
 * the row" have one answer. Everything browser-facing is injectable, which is
 * what lets the tests drive a create, an already-saved page and an unreadable
 * tab without a browser (the same seam `tabText.ts` uses).
 */
import { IconLink, pickBestIconUrl, readIconLinks, safeIconUrl } from './icon';
import {
  Shortcut,
  ShortcutPage,
  normalizeShortcutUrl,
  shortcutFromPage,
} from './Shortcut';
import { fetchIconAsDataUrl } from './iconBytes';
import { findShortcutByUrl, saveShortcut } from './util';

/** The fields the add path needs from a live Chrome tab. */
export interface ShortcutTabInfo {
  id: number;
  title: string;
  url: string;
  favIconUrl?: string;
}

export interface AddShortcutDeps {
  getTab?: (chromeTabId: number) => Promise<ShortcutTabInfo | null>;
  findLiveTabByUrl?: (url: string) => Promise<ShortcutTabInfo | null>;
  readIconLinks?: (chromeTabId: number) => Promise<IconLink[]>;
  fetchIcon?: (url: string) => Promise<string>;
  findExisting?: (url: string) => Promise<Shortcut | null>;
  save?: (shortcut: Shortcut) => Promise<Shortcut>;
}

export type AddShortcutStatus =
  | 'created'
  | 'existing'
  | 'invalid'
  | 'unreadable';

export interface AddShortcutResult {
  status: AddShortcutStatus;
  shortcut?: Shortcut;
}

/** @internal: what `addShortcutFromTab` already knows and the core reuses. */
interface ResolveOptions {
  iconLinks?: IconLink[];
  liveTabId?: number;
}

async function defaultGetTab(
  chromeTabId: number,
): Promise<ShortcutTabInfo | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return null;
  }
  try {
    const tab = await chrome.tabs.get(chromeTabId);
    if (typeof tab?.id !== 'number') {
      return null;
    }
    return {
      id: tab.id,
      title: tab.title ?? '',
      url: tab.url ?? '',
      favIconUrl: tab.favIconUrl ?? '',
    };
  } catch {
    // closed between the click and the read, or an id from another profile
    return null;
  }
}

async function defaultFindLiveTabByUrl(
  url: string,
): Promise<ShortcutTabInfo | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return null;
  }
  const wanted = normalizeShortcutUrl(url);
  if (wanted.length <= 0) {
    return null;
  }
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (normalizeShortcutUrl(tab.url ?? '') !== wanted) {
        continue;
      }
      if (typeof tab.id !== 'number') {
        continue;
      }
      return {
        id: tab.id,
        title: tab.title ?? '',
        url: tab.url ?? '',
        favIconUrl: tab.favIconUrl ?? '',
      };
    }
  } catch {
    // no live tab is a normal answer for "is this page open?"
  }
  return null;
}

/**
 * The best icon available right now: the page's own large link if it can be
 * read, otherwise the tab's favicon url, and bytes only when a url was found.
 */
async function resolveIcon(
  page: ShortcutPage,
  deps: AddShortcutDeps,
  options: ResolveOptions,
): Promise<{ iconDataUrl: string; iconUrl: string }> {
  let links = options.iconLinks;
  if (links === undefined) {
    const live =
      options.liveTabId !== undefined
        ? { id: options.liveTabId }
        : await (deps.findLiveTabByUrl ?? defaultFindLiveTabByUrl)(page.url);
    if (live) {
      const readLinks = deps.readIconLinks ?? readIconLinks;
      try {
        links = await readLinks(live.id);
      } catch {
        // an unscriptable page still gets a favicon or a monogram
        links = [];
      }
    }
  }
  const picked = pickBestIconUrl(links ?? [], page.url);
  const iconUrl =
    picked.length > 0 ? picked : safeIconUrl(page.favIconUrl ?? '');
  if (iconUrl.length <= 0) {
    return { iconDataUrl: '', iconUrl: '' };
  }
  const fetchIcon = deps.fetchIcon ?? fetchIconAsDataUrl;
  let iconDataUrl = '';
  try {
    iconDataUrl = await fetchIcon(iconUrl);
  } catch {
    // a logo that will not download is not a failed add
    iconDataUrl = '';
  }
  // An inline `data:` link is already the bytes: keeping it in `iconUrl` as
  // well would store the same picture twice (and sync it twice).
  const inline = iconUrl.toLowerCase().startsWith('data:');
  return { iconDataUrl, iconUrl: inline ? '' : iconUrl };
}

/**
 * Adds a shortcut for a page, or reports that one already exists.
 *
 * An existing row is kept as it is (the name the person may have edited, the
 * icon they already have) except for an empty icon, which is filled - the one
 * update that is strictly an improvement. A repeat add therefore costs no
 * write and no sync churn.
 */
export async function addShortcutFromPage(
  page: ShortcutPage,
  deps: AddShortcutDeps = {},
  options: ResolveOptions = {},
): Promise<AddShortcutResult> {
  const url = normalizeShortcutUrl(page.url);
  if (url.length <= 0) {
    return { status: 'invalid' };
  }
  const findExisting = deps.findExisting ?? findShortcutByUrl;
  const save = deps.save ?? saveShortcut;

  const existing = await findExisting(url);
  if (existing) {
    if (existing.iconDataUrl.length > 0) {
      return { status: 'existing', shortcut: existing };
    }
    const icon = await resolveIcon({ ...page, url }, deps, options);
    if (icon.iconDataUrl.length <= 0) {
      return { status: 'existing', shortcut: existing };
    }
    const filled = await save({
      ...existing,
      iconDataUrl: icon.iconDataUrl,
      iconUrl: existing.iconUrl || icon.iconUrl,
      // a fill is a write: without a newer stamp the LWW rule on the other
      // devices would keep the iconless copy they already have
      updatedAt: Date.now(),
    });
    return { status: 'existing', shortcut: filled };
  }

  const icon = await resolveIcon({ ...page, url }, deps, options);
  const shortcut = shortcutFromPage(
    { ...page, url },
    { iconDataUrl: icon.iconDataUrl, iconUrl: icon.iconUrl },
  );
  if (!shortcut) {
    return { status: 'invalid' };
  }
  const saved = await save(shortcut);
  return { status: 'created', shortcut: saved };
}

/**
 * Adds the live tab with this Chrome id. The tab read and the icon read are
 * both fail-soft: a tab that has gone away answers `unreadable`, and a page
 * that cannot be scripted is still added with its favicon (or a monogram).
 */
export async function addShortcutFromTab(
  chromeTabId: number,
  deps: AddShortcutDeps = {},
): Promise<AddShortcutResult> {
  if (!(chromeTabId > 0)) {
    return { status: 'unreadable' };
  }
  const getTab = deps.getTab ?? defaultGetTab;
  const tab = await getTab(chromeTabId);
  if (!tab || normalizeShortcutUrl(tab.url).length <= 0) {
    return { status: 'unreadable' };
  }
  const readLinks = deps.readIconLinks ?? readIconLinks;
  let iconLinks: IconLink[] = [];
  try {
    iconLinks = await readLinks(tab.id);
  } catch {
    iconLinks = [];
  }
  return addShortcutFromPage(
    { name: tab.title, url: tab.url, favIconUrl: tab.favIconUrl ?? '' },
    deps,
    { iconLinks, liveTabId: tab.id },
  );
}
