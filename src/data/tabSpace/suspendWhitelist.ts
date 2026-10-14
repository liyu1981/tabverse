/**
 * The per-tabverse "never suspend this tab" whitelist.
 *
 * A tabverse is a live window, and its tabs only exist while the manager page
 * that owns them is open - so the whitelist is device-local and page-resolved,
 * not a synced property of the tab. Two layers:
 *
 *  1. **Durable intent, in `chrome.storage.local`**, keyed by tabverse id and
 *     holding **URLs**. This is what the tab list toggles, and it survives a
 *     browser restart.
 *  2. **A resolved live set, in `chrome.storage.session`**, keyed by tabverse
 *     id and holding `chromeTabId`s. The manager page is the only context that
 *     knows both, so it publishes the mapping; the service worker reads it.
 *
 * It is the URL, not our `Tab.id`, because that id is minted when a tab is
 * first seen (a fresh nanoid on every manager-page load and every scan), so a
 * lock keyed by it would be forgotten the moment the page reloads or the
 * browser restarts. A URL means the same tab tomorrow, which is the whole point
 * of "never suspend this". Empty URLs are ignored: a tab still loading has
 * nothing to protect, and every such tab would otherwise match.
 *
 * The session layer is per-tabverse rather than one object so two manager pages
 * never race a read-modify-write of the same key. It is `chrome.storage.session`
 * rather than an in-memory map for the same reason `previewSession.ts` uses it:
 * a `chromeTabId` is scoped to one browser run, and the value has to survive the
 * worker being torn down and woken again. A key left behind by a closed page is
 * harmless - the worker only applies a tabverse's list to the window whose
 * manager tab carries that tabverse's `tvid`.
 *
 * `SavedTab` has no `chromeTabId` (`TabCore` excludes it), so the worker cannot
 * resolve the durable layer by itself; that is exactly why the page publishes
 * the resolved ids and the worker never reads `chrome.storage.local` for this.
 */
import { logger } from '../../global';
import {
  ChromeStorageArea,
  type StorageAreaLike,
} from '../../data/repo/outbox';
import type { Tab } from './Tab';

export const SUSPEND_WHITELIST_KEY = 'tabverse_suspend_whitelist_v2';
export const SUSPEND_WHITELIST_SESSION_PREFIX =
  'tabverse_suspend_whitelisted_tabs_v1:';

/** `chrome.storage.session` (promise form), narrowed to what is used here. */
export interface SessionAreaLike {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

const EMPTY: ReadonlySet<string> = new Set();

let durable: Map<string, Set<string>> = new Map();
let version = 0;
let storageOverride: StorageAreaLike | null = null;
let sessionOverride: SessionAreaLike | null = null;
const listeners = new Set<() => void>();

function storage(): StorageAreaLike {
  return storageOverride ?? new ChromeStorageArea();
}

function sessionArea(): SessionAreaLike | null {
  if (sessionOverride) {
    return sessionOverride;
  }
  if (typeof chrome === 'undefined' || !chrome.storage?.session) {
    return null;
  }
  return chrome.storage.session as unknown as SessionAreaLike;
}

function notify(): void {
  version += 1;
  for (const listener of Array.from(listeners)) {
    listener();
  }
}

function decodeDurable(value: unknown): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (!value || typeof value !== 'object') {
    return out;
  }
  for (const [tabSpaceId, urls] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (!Array.isArray(urls)) {
      continue;
    }
    const set = new Set(
      urls.filter(
        (url): url is string => typeof url === 'string' && url !== '',
      ),
    );
    if (set.size > 0) {
      out.set(tabSpaceId, set);
    }
  }
  return out;
}

/** The durable whitelist's version, for `useSyncExternalStore`. */
export function getWhitelistVersion(): number {
  return version;
}

export function subscribeWhitelist(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The whitelisted URLs for one tabverse. A stable set until it changes. */
export function getWhitelistedUrls(tabSpaceId: string): ReadonlySet<string> {
  return durable.get(tabSpaceId) ?? EMPTY;
}

export function isWhitelisted(tabSpaceId: string, url: string): boolean {
  return url !== '' && getWhitelistedUrls(tabSpaceId).has(url);
}

/** Reads the durable whitelist once; a failure reads as empty. */
export async function loadWhitelist(): Promise<void> {
  try {
    const raw = await storage().get([SUSPEND_WHITELIST_KEY]);
    durable = decodeDurable(raw[SUSPEND_WHITELIST_KEY]);
  } catch (err) {
    logger.log('could not read the suspension whitelist', err);
    durable = new Map();
  }
  notify();
}

async function persistDurable(): Promise<void> {
  const out: Record<string, string[]> = {};
  for (const [tabSpaceId, urls] of durable) {
    if (urls.size > 0) {
      out[tabSpaceId] = Array.from(urls);
    }
  }
  await storage().set({ [SUSPEND_WHITELIST_KEY]: out });
}

/** Adds or removes one URL; the in-memory answer moves before the write. */
export async function setWhitelisted(
  tabSpaceId: string,
  url: string,
  whitelisted: boolean,
): Promise<void> {
  // A tab with no URL yet has nothing to remember and would match every other
  // empty one, so it is not whitelisted at all.
  if (url === '') {
    return;
  }
  const next = new Set(durable.get(tabSpaceId) ?? []);
  if (whitelisted) {
    next.add(url);
  } else {
    next.delete(url);
  }
  if (next.size > 0) {
    durable.set(tabSpaceId, next);
  } else {
    durable.delete(tabSpaceId);
  }
  notify();
  try {
    await persistDurable();
  } catch (err) {
    logger.log('could not save the suspension whitelist', err);
  }
}

/** Flips one URL, and returns its new state. */
export async function toggleWhitelisted(
  tabSpaceId: string,
  url: string,
): Promise<boolean> {
  const next = !isWhitelisted(tabSpaceId, url);
  await setWhitelisted(tabSpaceId, url, next);
  return next;
}

/**
 * The live `chromeTabId`s of the tabs whose URL is whitelisted.
 *
 * Pure, so it is the part the tests pin: a tab with no live id (`-1` on a saved
 * tab) has nothing to protect and is dropped, and two tabs on the same URL are
 * both protected - the lock is on the URL, not on one of them.
 */
export function resolveWhitelistedChromeTabIds(
  whitelistedUrls: ReadonlySet<string>,
  tabs: Tab[],
): number[] {
  const out: number[] = [];
  for (const tab of tabs) {
    if (tab.chromeTabId > 0 && tab.url !== '' && whitelistedUrls.has(tab.url)) {
      out.push(tab.chromeTabId);
    }
  }
  return out;
}

/** Publishes one tabverse's resolved set for the worker; empty removes it. */
export async function publishWhitelistForTabSpace(
  tabSpaceId: string,
  chromeTabIds: number[],
): Promise<void> {
  const area = sessionArea();
  if (!area) {
    return;
  }
  const key = `${SUSPEND_WHITELIST_SESSION_PREFIX}${tabSpaceId}`;
  try {
    if (chromeTabIds.length > 0) {
      await area.set({ [key]: chromeTabIds });
    } else {
      await area.remove([key]);
    }
  } catch (err) {
    logger.log('could not publish the suspension whitelist', err);
  }
}

/** The union of every open tabverse's resolved set. Never rejects. */
export async function readWhitelistedChromeTabIds(): Promise<Set<number>> {
  const ids = new Set<number>();
  const area = sessionArea();
  if (!area) {
    return ids;
  }
  try {
    const all = await area.get(null);
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(SUSPEND_WHITELIST_SESSION_PREFIX)) {
        continue;
      }
      if (!Array.isArray(value)) {
        continue;
      }
      for (const id of value) {
        if (typeof id === 'number') {
          ids.add(id);
        }
      }
    }
  } catch (err) {
    logger.log('could not read the published suspension whitelist', err);
  }
  return ids;
}

/** Test hooks. */
export function setSuspendWhitelistStorageForTest(
  area: StorageAreaLike | null,
): void {
  storageOverride = area;
  durable = new Map();
  version = 0;
  listeners.clear();
}

export function setSuspendWhitelistSessionForTest(
  area: SessionAreaLike | null,
): void {
  sessionOverride = area;
}
