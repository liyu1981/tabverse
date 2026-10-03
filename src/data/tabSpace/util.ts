import { $tabSpace, querySavedTabSpaceCount, tabSpaceStoreApi } from './store';
import { QUERY_PAGE_LIMIT_DEFAULT, db } from '../../storage/db';
import {
  TABSPACE_DB_TABLE_NAME,
  TabSpace,
  TabSpaceSavePayload,
  addTabs,
  cloneTabSpace,
  convertAndGetTabSpaceSavePayload,
  findTabByChromeTabId,
  fromSavedDataWithoutTabs,
  insertTab,
  updateTab,
  updateTabSpace,
} from './TabSpace';
import { TAB_DB_TABLE_NAME, Tab, TabSavePayload, fromSavedTab } from './Tab';
import { TabSpaceDBMsg, subscribePubSubMessage } from '../../message/message';
import {
  debounce,
  hasOwn,
  isTabSpaceManagerPage,
  logger,
  perfEnd,
  perfStart,
} from '../../global';
import { isEqual, omit } from 'lodash';

import { DEFAULT_SAVE_DEBOUNCE } from '../../storage/StorageOverview';
import { orderWindowTabs, pinTabverseTabFirst } from './chromeUtil';
import { copyChromeTabFields } from './chromeTabFields';
import { planRestore } from './restorePlan';
import { captureTabGroups, restoreTabGroups } from './tabGroup';

export function monitorDbChanges() {
  subscribePubSubMessage(
    TabSpaceDBMsg.Changed,
    (message, changedTables: string[]) => {
      logger.log('pubsub:', message, changedTables);
      if (
        changedTables.includes(TABSPACE_DB_TABLE_NAME) ||
        changedTables.includes(TAB_DB_TABLE_NAME)
      ) {
        tabSpaceStoreApi.increaseSavedDataVersion();
        querySavedTabSpaceCount().then((savedTabSpaceCount: number) =>
          tabSpaceStoreApi.updateTotalSavedCount(savedTabSpaceCount),
        );
      }
    },
  );
}

export interface QuerySavedTabSpaceParams {
  anyOf?: string[];
  noneOf?: string[];
  pageStart?: number;
  pageLimit?: number;
}

export async function querySavedTabSpace(
  params?: QuerySavedTabSpaceParams,
): Promise<TabSpace[]> {
  perfStart('query table space');
  let savedData: TabSpaceSavePayload[];
  const pageStart = params?.pageStart ?? 0;
  const pageLimit = params?.pageLimit ?? QUERY_PAGE_LIMIT_DEFAULT;

  if (hasOwn(params, 'anyOf')) {
    savedData = await db
      .table<TabSpaceSavePayload>(TABSPACE_DB_TABLE_NAME)
      .bulkGet(params.anyOf);
    savedData.sort((d1, d2) => d2.createdAt - d1.createdAt);
    savedData = savedData.slice(
      pageStart * pageLimit,
      (pageStart + 1) * pageLimit,
    );
  } else if (hasOwn(params, 'noneOf')) {
    savedData = (
      await db
        .table<TabSpaceSavePayload>(TABSPACE_DB_TABLE_NAME)
        .where('id')
        .noneOf(params.noneOf)
        .sortBy('createdAt')
    ).reverse();
  } else {
    const savedDataQuery = db
      .table<TabSpaceSavePayload>(TABSPACE_DB_TABLE_NAME)
      .where('createdAt')
      .above(0)
      //.orderBy('createdAt')
      .reverse()
      .offset(pageStart)
      .limit(pageLimit);
    savedData = await savedDataQuery.toArray();
    //savedData = savedData.slice(pageStart * pageLimit, pageLimit);
  }
  perfEnd('query table space');

  perfStart('query tabIds for tabSpaces');
  // performance optimization to bulk load all tabs of tabSpaces then distribute
  const toLoadTabIds = savedData.reduce<string[]>((s, data) => {
    return s.concat(data.tabIds);
  }, []);
  const savedTabs = await db
    .table<TabSavePayload>(TAB_DB_TABLE_NAME)
    .bulkGet(toLoadTabIds);
  const savedTabSpaces = savedData.map((data) => {
    let tabSpace = fromSavedDataWithoutTabs(data);
    data.tabIds.forEach((tabId) => {
      const savedTab = savedTabs.find((savedTab) => savedTab.id === tabId);
      const tab = fromSavedTab(savedTab);
      tabSpace = insertTab({ tab }, tabSpace);
    });
    return tabSpace;
  });
  perfEnd('query tabIds for tabSpaces');

  return savedTabSpaces;
}

/**
 * Loads tabverses by id, with their tabs, keeping the given order.
 *
 * `querySavedTabSpace({anyOf})` sorts by creation date and pages, which is
 * what the browse list wants and the opposite of what a ranked search (or the
 * popup's recents) wants.
 */
export async function loadTabSpacesByIds(ids: string[]): Promise<TabSpace[]> {
  if (ids.length <= 0) {
    return [];
  }
  const savedTabSpaces = await db
    .table<TabSpaceSavePayload>(TABSPACE_DB_TABLE_NAME)
    .bulkGet(ids);
  const byId = new Map<string, TabSpaceSavePayload>();
  savedTabSpaces.forEach((row) => {
    if (row) {
      byId.set(row.id, row);
    }
  });
  const toLoadTabIds = Array.from(byId.values())
    .map((row) => row.tabIds ?? [])
    .flat();
  const savedTabs = await db
    .table<TabSavePayload>(TAB_DB_TABLE_NAME)
    .bulkGet(toLoadTabIds);
  const tabById = new Map<string, TabSavePayload>();
  savedTabs.forEach((row) => {
    if (row) {
      tabById.set(row.id, row);
    }
  });

  const tabSpaces: TabSpace[] = [];
  for (const id of ids) {
    const saved = byId.get(id);
    if (!saved) {
      continue;
    }
    let tabSpace = fromSavedDataWithoutTabs(saved);
    for (const tabId of saved.tabIds ?? []) {
      const savedTab = tabById.get(tabId);
      if (!savedTab) {
        continue;
      }
      tabSpace = insertTab({ tab: fromSavedTab(savedTab) }, tabSpace);
    }
    tabSpaces.push(tabSpace);
  }
  return tabSpaces;
}

/** How many tabverses the popup shows before the user searches. */
export const RECENT_TAB_SPACE_LIMIT = 10;

/**
 * The tabverses this device saw last, newest first.
 *
 * "Last updated" is the right signal here and it costs nothing: a tabverse is
 * saved on every tab event and once more at bootstrap, so the tabverse the
 * user just opened is the one at the top, and one they opened once and never
 * touched still drifts down instead of vanishing.
 *
 * `updatedAt` carries no index (only `createdAt` does), so this is a scan and
 * a sort. At RECENT_TAB_SPACE_LIMIT rows out of a full table, that is cheaper
 * than the Dexie version bump an index would need.
 */
export async function queryRecentSavedTabSpaces(
  limit: number = RECENT_TAB_SPACE_LIMIT,
): Promise<TabSpace[]> {
  const rows: TabSpaceSavePayload[] = await db
    .table<TabSpaceSavePayload>(TABSPACE_DB_TABLE_NAME)
    .toArray();
  const recent = rows
    .filter((row) => !!row)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
    .map((row) => row.id);
  return loadTabSpacesByIds(recent);
}

export async function querySavedTabSpaceById(
  tabSpaceId: string,
): Promise<TabSpace> {
  const savedTabSpaces = await querySavedTabSpace({ anyOf: [tabSpaceId] });
  if (savedTabSpaces.length !== 1) {
    throw new Error(
      `queried saved tabspace id ${tabSpaceId} returns ${savedTabSpaces.length} results!`,
    );
  }
  return savedTabSpaces[0];
}

export async function saveTabSpace(targetTabSpace: TabSpace): Promise<number> {
  const isCurrentTabSpace = targetTabSpace.id === $tabSpace.getState().id;
  // What the store holds just before it is replaced below. The update inside the
  // transaction swaps the live list for this save's own copy, so a tab the store
  // gained after `targetTabSpace` was taken - a tab created while this save was
  // running, which is what a burst of tab events does - would be dropped from the
  // live list with no chance of ever being written. The merge after the save
  // needs both that list and the store's, to see every tab either had.
  let tabsBeforeUpdate: Tab[] = [];
  const updatedTabSpace = await db.transaction(
    'rw',
    [db.table(TAB_DB_TABLE_NAME), db.table(TABSPACE_DB_TABLE_NAME)],
    async (_tx) => {
      const {
        tabSpace: updatedTabSpace,
        tabSpaceSavePayload,
        tabSavePayloads,
      } = convertAndGetTabSpaceSavePayload(targetTabSpace);
      logger.log(
        'save tabSpaceSavePayload is:',
        targetTabSpace,
        $tabSpace.getState(),
        tabSpaceSavePayload,
        tabSavePayloads,
      );
      if (isCurrentTabSpace) {
        tabsBeforeUpdate = $tabSpace.getState().tabs.toArray();
        tabSpaceStoreApi.update(updatedTabSpace);
      }
      // every id is final from the moment a record is created, so a row that is
      // not in the database yet and one that is there both go in with put
      await db.table(TABSPACE_DB_TABLE_NAME).put(tabSpaceSavePayload);
      await db.table(TAB_DB_TABLE_NAME).bulkPut(tabSavePayloads);
      return updatedTabSpace;
    },
  );
  if (isCurrentTabSpace) {
    mayBeSaveCurrentAgain(updatedTabSpace, tabsBeforeUpdate);
  }
  return updatedTabSpace.updatedAt;
}

function mayBeSaveCurrentAgain(
  updatedTabSpace: TabSpace,
  /** The store's tabs at the moment `saveTabSpace` replaced it. */
  tabsBeforeUpdate: Tab[] = [],
) {
  const currentTabSpace = $tabSpace.getState();
  let mergedTabSpace = cloneTabSpace(updatedTabSpace);
  let changed = false;
  if (updatedTabSpace.name !== currentTabSpace.name) {
    changed = true;
    mergedTabSpace.name = currentTabSpace.name;
  }
  if (updatedTabSpace.chromeTabId !== currentTabSpace.chromeTabId) {
    changed = true;
    mergedTabSpace.chromeTabId = currentTabSpace.chromeTabId;
  }
  if (updatedTabSpace.chromeWindowId !== currentTabSpace.chromeWindowId) {
    changed = true;
    mergedTabSpace.chromeWindowId = currentTabSpace.chromeWindowId;
  }
  const noConsiderFields = [
    'version',
    'createdAt',
    'updatedAt',
    'id',
    'tabSpaceId',
  ];
  // Every tab the store had or has, once each: the ones taken just before the
  // update (it may have dropped them, being a copy of `targetTabSpace`) and the
  // ones in the store now (they may have arrived after it). Keyed by our own
  // tab id, which is final and unique - not by chromeTabId, which a tab that
  // has no live tab yet shares.
  const liveById = new Map<string, Tab>();
  for (const tab of [...tabsBeforeUpdate, ...currentTabSpace.tabs]) {
    liveById.set(tab.id, tab);
  }
  for (const ct of liveById.values()) {
    const ut = findTabByChromeTabId(ct.chromeTabId, updatedTabSpace);
    if (!ut) {
      // The tabverse has a tab that the row just written has no part of: it was
      // added while this save ran (the burst of tab events a split view creates
      // does exactly this), and without adding it here the store's copy of it
      // was dropped by the update above and the row never carried it. It was
      // adding `ut`, which is `undefined` here: immer threw "Cannot set
      // properties of undefined", the re-save below never ran, and the error
      // went out as an unhandled rejection.
      mergedTabSpace = addTabs([ct], mergedTabSpace);
      changed = true;
    } else {
      if (!isEqual(omit(ct, noConsiderFields), omit(ut, noConsiderFields))) {
        mergedTabSpace = updateTab(
          { tid: ut.id, changes: omit(ct, noConsiderFields) },
          mergedTabSpace,
        );
        changed = true;
      }
    }
  }

  if (changed) {
    logger.log(
      'detected changed after save, will merge and save again',
      mergedTabSpace,
    );
    setTimeout(() => {
      tabSpaceStoreApi.update(mergedTabSpace);
      saveCurrentTabSpace();
    });
  }
}

export async function deleteSavedTabSpace(
  savedTabSpaceId: string,
): Promise<void> {
  await db.transaction(
    'rw',
    [db.table(TAB_DB_TABLE_NAME), db.table(TABSPACE_DB_TABLE_NAME)],
    async (_tx) => {
      const savedTabSpace = await db
        .table<TabSpaceSavePayload>(TABSPACE_DB_TABLE_NAME)
        .get(savedTabSpaceId);
      await db.table(TAB_DB_TABLE_NAME).bulkDelete(savedTabSpace.tabIds);
      await db.table(TABSPACE_DB_TABLE_NAME).delete(savedTabSpace.id);
    },
  );
}

const saveCurrentTabSpaceImpl = async () => {
  tabSpaceStoreApi.markInSaving(true);
  const currentTabSpace = $tabSpace.getState();
  const savedTime = await saveTabSpace(currentTabSpace);
  tabSpaceStoreApi.updateLastSavedTime(savedTime);
  tabSpaceStoreApi.markInSaving(false);
};

/**
 * Saves without waiting for the debounce.
 *
 * "Save and close" needs this: the page is about to go away, and a debounced
 * save that has not fired yet dies with it.
 */
export const saveCurrentTabSpaceNow: () => Promise<void> =
  saveCurrentTabSpaceImpl;

/**
 * Saves the tabverse of this window, debounced.
 *
 * This is the autosave, and it is unconditional: a tabverse is born saved (its
 * id is minted when the Tabverse tab is opened and travels in the url as
 * `tvid`), so there is no "unsaved" state to ask about. That question used to
 * be `needAutoSave()` behind `saveCurrentTabSpaceIfNeeded()`; both are gone,
 * and there is deliberately no replacement - a gate that cannot say no is a
 * branch nobody can test.
 */
export const saveCurrentTabSpace: () => void | Promise<void> = debounce(
  saveCurrentTabSpaceImpl,
  DEFAULT_SAVE_DEBOUNCE,
);

export async function moveTabsToTabSpace(
  toMoveTabs: Tab[],
  targetTabSpace: TabSpace,
) {
  let newTabSpace = cloneTabSpace(targetTabSpace);
  newTabSpace = addTabs(toMoveTabs, newTabSpace);
  await saveTabSpace(newTabSpace);
}

/**
 * Loads a saved tabverse into the window the manager page is in.
 *
 * The window is emptied of everything that is not part of the tabverse - the
 * tabs the user had open here are the ones being replaced - but a tab of the
 * saved tabverse that is *already* open here is kept rather than closed and
 * opened again (see restorePlan.ts). Kept tabs keep their place in the window,
 * its history and its state; the tabverse then owns the order, so the strip is
 * put back into the saved order and every tab's live fields (chromeTabId above
 * all - the store's copy of it is what the list's buttons act on) are set from
 * what the browser actually has.
 */
export async function loadTabSpaceByTabSpaceId(
  savedTabSpaceId: string,
  chromeTabId: number,
  chromeWindowId: number,
) {
  let tabSpace = await querySavedTabSpaceById(savedTabSpaceId);
  tabSpace = updateTabSpace({ chromeTabId, chromeWindowId }, tabSpace);

  const windowTabs = await chrome.tabs.query({ currentWindow: true });
  const plan = planRestore(tabSpace.tabs.toArray(), windowTabs, chromeTabId);
  logger.log(
    `restoring "${tabSpace.name}": opening ${plan.createTabs.length}, ` +
      `keeping ${plan.entries.length - plan.createTabs.length}, ` +
      `closing ${plan.removeChromeTabIds.length}`,
  );

  await Promise.all(
    plan.removeChromeTabIds.map((id) => chrome.tabs.remove(id)),
  );

  // here we do not use map but use for loop to ensure that we restore tabs in
  // the saved order
  //
  // Pinned tabs are created unpinned and pinned afterwards, in saved order.
  // Passing `pinned` (or an index) to tabs.create() would make Chrome resolve
  // the position inside the pinned section, whose index semantics are not
  // documented; pinning in order afterwards reproduces the saved order without
  // depending on that. The same is true of a reused tab: if the window had it
  // pinned and the tabverse saved it unpinned (or the other way round), the
  // saved row is the truth, so it is set below.
  const pinnedBeforeRestore = new Map<number, boolean>(
    windowTabs.map((tab) => [tab.id, !!tab.pinned]),
  );
  const chromeTabIdByOurTabId = new Map<string, number>();
  for (const entry of plan.entries) {
    if (entry.reuseChromeTabId !== undefined) {
      chromeTabIdByOurTabId.set(entry.savedTab.id, entry.reuseChromeTabId);
      continue;
    }
    const created = await chrome.tabs.create({
      url: entry.savedTab.url,
      windowId: chromeWindowId,
    });
    if (created?.id !== undefined) {
      chromeTabIdByOurTabId.set(entry.savedTab.id, created.id);
    }
  }

  const pinnedChromeTabIds = new Set<number>();
  for (const entry of plan.entries) {
    const liveTabId = chromeTabIdByOurTabId.get(entry.savedTab.id);
    if (liveTabId === undefined) {
      // the tab could not be opened; restore is best effort
      continue;
    }
    // a tab created above was never pinned, so it is not in the map
    const wasPinned = pinnedBeforeRestore.get(liveTabId) ?? false;
    if (wasPinned !== entry.pinned) {
      try {
        await chrome.tabs.update(liveTabId, { pinned: entry.pinned });
      } catch (err) {
        logger.log(
          'could not set the pinned state of a restored tab',
          entry.savedTab.id,
          err,
        );
        continue;
      }
    }
    if (entry.pinned) {
      pinnedChromeTabIds.add(liveTabId);
    }
  }

  // the tabverse's own pinned tabs were just pinned, so put the tabverse tab
  // back at the front of the pinned section
  await pinTabverseTabFirst(chromeTabId);

  // the window is a mixture now - tabs that were here and tabs that were just
  // opened - and only the saved order makes the strip match the list
  const chromeTabIdsInSavedOrder = (pinned: boolean) =>
    plan.entries
      .filter((entry) => entry.pinned === pinned)
      .map((entry) => chromeTabIdByOurTabId.get(entry.savedTab.id))
      .filter((id): id is number => id !== undefined);
  await orderWindowTabs(chromeWindowId, [
    chromeTabId,
    ...chromeTabIdsInSavedOrder(true),
    ...chromeTabIdsInSavedOrder(false),
  ]);

  // groups last: chrome.tabs.group() needs every tab to exist, and a split view
  // (which requires matching group state) is created after this. Reused tabs are
  // in the map like the new ones, so a group can land on either.
  const restoredGroups = await restoreTabGroups(
    tabSpace.tabGroups,
    chromeTabIdByOurTabId,
    (tabId) => pinnedChromeTabIds.has(tabId),
  );
  if (restoredGroups > 0) {
    logger.log(`restored ${restoredGroups} tab group(s)`);
  }

  // the store's copy of a tabverse carries live fields that are not saved, and
  // a reused tab raises no event to fill them in
  for (const entry of plan.entries) {
    const liveTabId = chromeTabIdByOurTabId.get(entry.savedTab.id);
    if (liveTabId === undefined) {
      continue;
    }
    tabSpace = updateTab(
      {
        tid: entry.savedTab.id,
        changes: {
          chromeTabId: liveTabId,
          chromeWindowId,
          pinned: entry.pinned,
        },
      },
      tabSpace,
    );
  }
  tabSpaceStoreApi.update(tabSpace);

  await scanRestoredWindow(
    chromeWindowId,
    plan.entries.flatMap((entry) =>
      entry.reuseChromeTabId === undefined ? [] : [entry.reuseChromeTabId],
    ),
  );

  // focus tabspace tab
  const currentTab = await chrome.tabs.getCurrent();
  await chrome.tabs.update(currentTab.id, { active: true });
}

/**
 * Reads the window back, once, at the end of a restore.
 *
 * `keptChromeTabIds` are the tabs the restore left where they were - the ones
 * it reused rather than reopened. They are the gap this closes: keeping a tab
 * open is the whole point of the restore (see restorePlan.ts), and a tab that
 * is never closed and opened raises no tab event, so nothing else would ever
 * correct the store's copy of it. Without this the tabverse describes a window
 * that does not exist, and most visibly the split view: a pair of tabs the user
 * has open side by side comes back into the tabverse as two ordinary tabs,
 * because there is no write path to put a split back (Chrome 155+) and the one
 * already in the window was never read. splitViewId is a read from Chrome 140
 * on (see src/capabilities.ts), so showing it costs nothing.
 *
 * The tabs the restore *did* open are deliberately left to the tab event path:
 * a tab that was created a moment ago has the url where its title will be until
 * the page loads, and reading it back here would replace a good title with it.
 *
 * It is a scan and not a save: splitViewId, chromeTabId and chromeWindowId are
 * live fields that are never written to the database, and a saved field the
 * window disagrees about (a kept tab's title, a tab pinned here and saved
 * loose) is picked up by the next real save, exactly like the metadata-only
 * updates of the tab event path.
 */
export async function scanRestoredWindow(
  windowId: number,
  keptChromeTabIds: Iterable<number>,
): Promise<void> {
  const tabSpace = $tabSpace.getState();
  const kept = new Set(keptChromeTabIds);
  const chromeTabs = await chrome.tabs.query({ windowId });
  const tabIdByChromeTabId = new Map<number, string>();
  let refreshedTabSpace = tabSpace;
  let refreshedCount = 0;
  for (const chromeTab of chromeTabs) {
    if (chromeTab.id === undefined || isTabSpaceManagerPage(chromeTab)) {
      continue;
    }
    const existing = findTabByChromeTabId(chromeTab.id, tabSpace);
    if (!existing) {
      // not a tab of the tabverse: the manager tab, or one the user opened
      // while the restore ran - the tab event path has it
      continue;
    }
    tabIdByChromeTabId.set(chromeTab.id, existing.id);
    if (!kept.has(chromeTab.id)) {
      continue;
    }
    const refreshed = copyChromeTabFields(chromeTab, existing);
    if (!isEqual(refreshed, existing)) {
      refreshedTabSpace = updateTab(
        { tid: existing.id, changes: refreshed },
        refreshedTabSpace,
      );
      refreshedCount += 1;
    }
  }
  if (refreshedCount > 0) {
    tabSpaceStoreApi.update(refreshedTabSpace);
  }

  // the groups of the whole window, which is also how a group
  // restoreTabGroups had to skip (too few tabs left, pinned mixed with loose)
  // stops being claimed
  const groups = await captureTabGroups(windowId, tabIdByChromeTabId);
  if (groups) {
    tabSpaceStoreApi.setTabGroups(groups);
  }
  logger.log(
    `scanned the restored window: ${refreshedCount} kept tab(s) refreshed, ` +
      `${groups?.length ?? 0} group(s)`,
  );
}
