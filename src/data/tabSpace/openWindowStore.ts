/**
 * The tabverses open in this browser, as the manager page draws them.
 *
 * ADR 0006 gave the sidebar's "other windows" list up, because answering it
 * needed a registry (leader election over a broadcast channel) and the cost was
 * not worth it. It no longer does: every Tabverse tab carries its tabverse id
 * in its url as `tvid` (`tabverseUrl`), so `chrome.tabs.query({})` says which
 * tabverses are open and in which windows, with no state to keep consistent.
 * The popup reached that conclusion first (`doc/tabverse-popup-plan.md` D8);
 * this is the same answer, for the sidebar.
 *
 * Three pieces, in the direction the data flows:
 *
 *   chrome.tabs.* ─debounce─► refreshOpenTabSpaces() ─► $openTabSpaces
 *                                                            │
 *                        $tabSpace (this page's own window) ─┤
 *                                                            ▼
 *                                                  $otherWindowTabSpaces
 *                                                            │
 *                       loadOtherWindowNames() ─► $otherWindowNames
 *                                                            ▼
 *                                                     $otherWindowRows
 *
 * The names come from IndexedDB, joined on the id from the query - never the
 * other way round, because `loadTabSpacesByIds` drops ids it cannot find and a
 * list that empties itself when a row is a moment late is worse than one row
 * with no name. `tabSpaceBootstrap` writes `Window-<id>` and saves before the
 * first tab event, so a neighbour's row exists from its first second.
 *
 * Scope is one Chrome profile. Another profile is another extension install
 * with its own IndexedDB, and its tabs are not visible to `tabs.query` here.
 */

import { combine, createApi, createStore } from 'effector';

import { $tabSpace } from './store';
import { loadTabSpacesByIds } from './util';
import {
  OpenTabSpace,
  openTabSpaceOfWindow,
  otherWindowTabSpaces,
  queryOpenTabSpaces,
} from './openTabverses';
import { switchToOpenTabSpace } from './openTabverses';
import { logger } from '../../global';

/** A tabverse open in another window, with what the row is called. */
export interface OtherWindowRow extends OpenTabSpace {
  name: string;
  tabCount: number;
}

/** Everything open in this profile, one entry per window. */
export const $openTabSpaces = createStore<OpenTabSpace[]>([]);

const openTabSpaceApi = createApi($openTabSpaces, {
  setOpenTabSpaces: (_last, open: OpenTabSpace[]) => open,
});

/** The tabverses open in windows other than this page's own. */
export const $otherWindowTabSpaces = combine(
  $openTabSpaces,
  $tabSpace,
  (open, self): OpenTabSpace[] =>
    otherWindowTabSpaces(open, {
      windowId: self.chromeWindowId,
      tabSpaceId: self.id,
    }),
);

/** name + tab count per tabverse id, for the ones that are open. */
export const $otherWindowNames = createStore<
  Map<string, { name: string; tabCount: number }>
>(new Map());

// effector 23 has no store.set: every write goes through an api, like the rest
// of the codebase. (Writing it as a plain `set` throws a TypeError, and
// `logger.error` is silent under the test log level - which is how a missing
// declaration here once looked like "the names did not load".)
const otherWindowNamesApi = createApi($otherWindowNames, {
  setOtherWindowNames: (
    _last,
    names: Map<string, { name: string; tabCount: number }>,
  ) => names,
});

/**
 * The rows the sidebar draws: the window's tabverse, decorated.
 *
 * A tabverse whose saved row is not here yet keeps its place with an empty name
 * and no count - see the file header.
 */
export const $otherWindowRows = combine(
  $otherWindowTabSpaces,
  $otherWindowNames,
  (open, names): OtherWindowRow[] =>
    open.map((row) => {
      const saved = names.get(row.tabSpaceId);
      return {
        ...row,
        name: saved?.name ?? '',
        tabCount: saved?.tabCount ?? 0,
      };
    }),
);

/**
 * Both writes, for callers that have the answer already (and for tests).
 *
 * A plain spread rather than effector's `merge`: `merge` wants units, and two
 * `createApi` results are not units (the codebase gets away with it where a
 * plain object literal follows, which is a subtlety not worth relying on).
 */
export const openWindowStoreApi = {
  ...openTabSpaceApi,
  ...otherWindowNamesApi,
};

/**
 * Re-reads which tabverses are open, and then what they are called.
 *
 * Two reads, not one: the browser says where, IndexedDB says what. The name
 * read is skipped entirely when nothing is open, which is the common case for a
 * profile with a single window.
 */
export async function refreshOpenTabSpaces(): Promise<OpenTabSpace[]> {
  const open = await queryOpenTabSpaces();
  openWindowStoreApi.setOpenTabSpaces(open);
  await loadOtherWindowNames(open);
  return open;
}

/** Fills the name/count map for the tabverses that are open. */
export async function loadOtherWindowNames(
  open: OpenTabSpace[] = $openTabSpaces.getState(),
): Promise<void> {
  const ids = Array.from(new Set(open.map((row) => row.tabSpaceId)));
  if (ids.length <= 0) {
    return;
  }
  try {
    const saved = await loadTabSpacesByIds(ids);
    openWindowStoreApi.setOtherWindowNames(
      new Map(
        saved.map((row) => [
          row.id,
          { name: row.name, tabCount: row.tabs.size },
        ]),
      ),
    );
  } catch (err) {
    // A name is a label, not the list: the rows stay, undecorated. This is the
    // one place a failed read is allowed to pass quietly, and it is logged
    // rather than dropped.
    logger.error("could not read the open tabverses' names", err);
  }
}

/** Goes to the window that has this tabverse. */
export async function switchToOtherWindow(row: OpenTabSpace): Promise<void> {
  await switchToOpenTabSpace(row);
}

/** The tabverse open in this window, if any (at most one, ADR 0006). */
export function thisWindowsTabSpace(
  open: OpenTabSpace[] = $openTabSpaces.getState(),
): OpenTabSpace | undefined {
  return openTabSpaceOfWindow(open, $tabSpace.getState().chromeWindowId);
}

// ---- the monitor -----------------------------------------------------------

/**
 * The debounce's clock, injectable so a test can drive it (the same shape as
 * `data/repo/realtime.ts`, and for the same reason: fake timers cannot hijack
 * `performance` on modern node).
 */
export interface OpenTabSpacesScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realScheduler: OpenTabSpacesScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Set by tests; null means "use real timers". */
let schedulerOverride: OpenTabSpacesScheduler | null = null;

export function setOpenTabSpacesSchedulerForTest(
  scheduler: OpenTabSpacesScheduler | null,
): void {
  schedulerOverride = scheduler;
}

const REFRESH_DEBOUNCE_MS = 250;

/**
 * Watches the browser for "a tabverse opened, closed or moved".
 *
 * The page's own tab listeners (startMonitorTabChanges) already exist for the
 * tabverse being edited here; these are for the other windows, and the payload
 * is a re-read rather than a diff - `tabs.query` over a handful of tabs is
 * cheaper than keeping an accurate incremental set.
 *
 * The debounce is what keeps a window restore (dozens of tab events) to one
 * read, and why this is affordable at all: the page may be open for hours.
 */
export function startMonitorOpenTabSpaces(): () => void {
  const scheduler = schedulerOverride ?? realScheduler;
  let handle: unknown = null;
  const schedule = () => {
    if (handle !== null) {
      scheduler.clearTimeout(handle);
    }
    handle = scheduler.setTimeout(() => {
      handle = null;
      void refreshOpenTabSpaces();
    }, REFRESH_DEBOUNCE_MS);
  };

  // first read, so the list is right before anyone can look at it
  void refreshOpenTabSpaces();

  chrome.tabs.onCreated.addListener(schedule);
  chrome.tabs.onRemoved.addListener(schedule);
  chrome.tabs.onUpdated.addListener(schedule);
  chrome.tabs.onAttached.addListener(schedule);
  chrome.tabs.onDetached.addListener(schedule);
  // focusing a window is when a person is about to look at the list
  chrome.windows.onRemoved.addListener(schedule);
  chrome.windows.onFocusChanged.addListener(schedule);

  return () => {
    chrome.tabs.onCreated.removeListener(schedule);
    chrome.tabs.onRemoved.removeListener(schedule);
    chrome.tabs.onUpdated.removeListener(schedule);
    chrome.tabs.onAttached.removeListener(schedule);
    chrome.tabs.onDetached.removeListener(schedule);
    chrome.windows.onRemoved.removeListener(schedule);
    chrome.windows.onFocusChanged.removeListener(schedule);
    if (handle !== null) {
      scheduler.clearTimeout(handle);
      handle = null;
    }
  };
}
