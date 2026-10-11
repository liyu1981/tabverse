/**
 * The per-tabverse "never suspend this tab" whitelist.
 *
 * A tabverse is a live window, and its tabs only exist while the manager page
 * that owns them is open - so the whitelist is device-local and page-resolved,
 * not a synced property of the tab. Two layers:
 *
 *  1. **Durable intent, in `chrome.storage.local`**, keyed by tabverse id and
 *     holding our own `Tab.id`s. This is what the tab list toggles, and it
 *     survives a browser restart.
 *  2. **A resolved live set, in `chrome.storage.session`**, keyed by tabverse
 *     id and holding `chromeTabId`s. The manager page is the only context that
 *     knows both, so it publishes the mapping; the service worker reads it.
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

export const SUSPEND_WHITELIST_KEY = 'tabverse_suspend_whitelist_v1';
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
  for (const [tabSpaceId, ids] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (!Array.isArray(ids)) {
      continue;
    }
    const set = new Set(
      ids.filter((id): id is string => typeof id === 'string' && id.length > 0),
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

/** The whitelisted tab ids for one tabverse. A stable set until it changes. */
export function getWhitelistedTabIds(tabSpaceId: string): ReadonlySet<string> {
  return durable.get(tabSpaceId) ?? EMPTY;
}

export function isWhitelisted(tabSpaceId: string, tabId: string): boolean {
  return getWhitelistedTabIds(tabSpaceId).has(tabId);
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
  for (const [tabSpaceId, ids] of durable) {
    if (ids.size > 0) {
      out[tabSpaceId] = Array.from(ids);
    }
  }
  await storage().set({ [SUSPEND_WHITELIST_KEY]: out });
}

/** Adds or removes one tab; the in-memory answer moves before the write. */
export async function setWhitelisted(
  tabSpaceId: string,
  tabId: string,
  whitelisted: boolean,
): Promise<void> {
  const next = new Set(durable.get(tabSpaceId) ?? []);
  if (whitelisted) {
    next.add(tabId);
  } else {
    next.delete(tabId);
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

/** Flips one tab, and returns its new state. */
export async function toggleWhitelisted(
  tabSpaceId: string,
  tabId: string,
): Promise<boolean> {
  const next = !isWhitelisted(tabSpaceId, tabId);
  await setWhitelisted(tabSpaceId, tabId, next);
  return next;
}

/**
 * The live `chromeTabId`s of the whitelisted tabs, in the order given.
 *
 * Pure, so it is the part the tests pin: a tab with no live id (`-1` on a saved
 * tab) has nothing to protect and is dropped.
 */
export function resolveWhitelistedChromeTabIds(
  whitelistedTabIds: ReadonlySet<string>,
  tabs: Tab[],
): number[] {
  const out: number[] = [];
  for (const tab of tabs) {
    if (tab.chromeTabId > 0 && whitelistedTabIds.has(tab.id)) {
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
