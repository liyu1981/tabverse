import { $allClosedTab, closedTabStoreApi } from './store';
import {
  allClosedTabFromRows,
  convertAndGetClosedTabSavePayloads,
} from './AllClosedTab';
import {
  CLOSED_TAB_DB_TABLE_NAME,
  ClosedTab,
  newClosedTabFromTab,
} from './ClosedTab';
import { TabSpaceDBMsg, subscribePubSubMessage } from '../../message/message';
import { TabCore } from '../tabSpace/Tab';
import { db } from '../../storage/db';
import { debounce, logger } from '../../global';
import { $tabSpace } from '../tabSpace/store';
import { DEFAULT_SAVE_DEBOUNCE } from '../../storage/StorageOverview';

/**
 * The closed tabs of the *current* tabverse, newest first.
 *
 * Capture happens in the manager page that owns the window (see
 * `getOnChromeTabRemoved` in ../tabSpace/chromeTab.ts), i.e. in this same
 * context, so recording is a store write plus the usual debounced save. Rows
 * go to the database and, through the change feed, to the sync server as the
 * `closedtab` entity.
 *
 * There is no localStorage fallback, and neither is there one on the right
 * side tools any more: a tabverse is born saved, so there has been no unsaved
 * state to fall back to since ids were minted in the tab's url.
 */

/**
 * A tab closed in this tabverse on *another* device arrives as a write in this
 * browser's database (by the service worker, on behalf of the sync engine), so
 * the open panel has to re-read. Local writes notify too, which is why a
 * reload is skipped while one of ours is still on its way to the database.
 */
export function startMonitorDbChanges() {
  if (dbChangesMonitorStarted) {
    return;
  }
  dbChangesMonitorStarted = true;
  subscribePubSubMessage(
    TabSpaceDBMsg.Changed,
    (_message, changedTables: string[]) => {
      if (!changedTables.includes(CLOSED_TAB_DB_TABLE_NAME)) {
        return;
      }
      if (localChangePending) {
        return;
      }
      logger.log('closed tab table changed, reloading the history');
      void loadClosedTabsByTabSpaceId($tabSpace.getState().id);
    },
  );
}

/** Set while the store holds a change the database does not have yet. */
let localChangePending = false;
let dbChangesMonitorStarted = false;

/** Reads the newest rows of one tabverse, capped at the history limit. */
export async function queryClosedTabs(
  tabSpaceId: string,
): Promise<ClosedTab[]> {
  const rows = await db
    .table<ClosedTab>(CLOSED_TAB_DB_TABLE_NAME)
    .where('tabSpaceId')
    .equals(tabSpaceId)
    .toArray();
  return allClosedTabFromRows(tabSpaceId, rows).closedTabs.toArray();
}

export async function loadClosedTabsByTabSpaceId(tabSpaceId: string) {
  const rows = await queryClosedTabs(tabSpaceId);
  closedTabStoreApi.update(allClosedTabFromRows(tabSpaceId, rows));
}

async function saveAllClosedTabsImpl(): Promise<number> {
  const before = $allClosedTab.getState();
  const { allClosedTab, closedTabSavePayloads } =
    convertAndGetClosedTabSavePayloads(before);
  const keptIds = new Set(allClosedTab.closedTabs.map((t) => t.id).toArray());
  const updatedAt = await db.transaction(
    'rw',
    [db.table(CLOSED_TAB_DB_TABLE_NAME)],
    async (_tx) => {
      await db.table(CLOSED_TAB_DB_TABLE_NAME).bulkPut(closedTabSavePayloads);
      // rows the store no longer holds: deleted by the user, cleared in bulk,
      // or pushed off the end by the cap. Deleting them (rather than leaving
      // them behind) is what turns into a tombstone on the server.
      const idsInDb = (
        await db
          .table(CLOSED_TAB_DB_TABLE_NAME)
          .where('tabSpaceId')
          .equals(allClosedTab.tabSpaceId)
          .primaryKeys()
      ).map((id) => String(id));
      const staleIds = idsInDb.filter((id) => !keptIds.has(id));
      if (staleIds.length > 0) {
        await db.table(CLOSED_TAB_DB_TABLE_NAME).bulkDelete(staleIds);
      }
      return Date.now();
    },
  );
  closedTabStoreApi.update(allClosedTab);
  closedTabStoreApi.updateLastSavedTime(updatedAt);
  return updatedAt;
}

/**
 * Saves never overlap: closing a burst of tabs can start a save while the
 * previous one is still writing, and two concurrent transactions would both
 * try to add the same row.
 */
let pendingSave: Promise<number> = Promise.resolve(0);

export function saveAllClosedTabs(): Promise<number> {
  pendingSave = pendingSave.catch(() => 0).then(saveAllClosedTabsImpl);
  return pendingSave;
}

const saveCurrentClosedTabsImpl = async () => {
  closedTabStoreApi.markInSaving(true);
  try {
    const savedTime = await saveAllClosedTabs();
    closedTabStoreApi.updateLastSavedTime(savedTime);
  } finally {
    localChangePending = false;
    closedTabStoreApi.markInSaving(false);
  }
};

export const saveCurrentClosedTabs = debounce(
  saveCurrentClosedTabsImpl,
  DEFAULT_SAVE_DEBOUNCE,
);

/**
 * Records one tab that left this tabverse. The tab is looked up by the caller
 * *before* it is removed from the tabspace store, so its title/url are still
 * there.
 */
export function recordClosedTab(tab: TabCore, closedAt: number = Date.now()) {
  if (!tab.url) {
    // a tab Chrome gave no url yet (a fresh NTP during load, say)
    return;
  }
  const tabSpaceId = $tabSpace.getState().id;
  const store = $allClosedTab.getState();
  if (store.tabSpaceId !== tabSpaceId && store.closedTabs.size > 0) {
    // The store holds *another* tabverse's history, and this is not the panel
    // having never been opened (an empty store has nothing to lose): this is
    // what a restore leaves behind, because the window is now a different
    // tabverse (loadTabSpaceByTabSpaceId). Re-labelling those rows is what used
    // to empty the history - they were filed under the new tabverse, and the
    // save that followed deleted the new tabverse's own rows as stale, which
    // the change feed then pushed to the server as tombstones. So the rows
    // that belong to this tabverse are read first, and the tab recorded into
    // those.
    recordOnceStoreIsOnTabSpace(tabSpaceId, tab, closedAt);
    return;
  }
  if (store.tabSpaceId !== tabSpaceId) {
    // nothing loaded yet (the panel was never opened), so naming the tabverse
    // is all it takes
    closedTabStoreApi.updateTabSpaceId(tabSpaceId);
  }
  addClosedTabToStore(tab, tabSpaceId, closedAt);
}

/**
 * Records that arrived while the store was still showing another tabverse.
 *
 * A burst of closes lands together - closing a window fires onRemoved once per
 * tab - and every load replaces the store wholesale, so records that arrived
 * during one would be wiped by the next. They wait here instead, and are added
 * once the store is on the right tabverse.
 */
let pendingRecords: { tab: TabCore; closedAt: number }[] = [];
let pendingSwitch: Promise<void> | null = null;

function recordOnceStoreIsOnTabSpace(
  tabSpaceId: string,
  tab: TabCore,
  closedAt: number,
) {
  pendingRecords.push({ tab, closedAt });
  if (pendingSwitch) {
    return;
  }
  pendingSwitch = loadClosedTabsByTabSpaceId(tabSpaceId)
    .then(() => {
      const records = pendingRecords;
      pendingRecords = [];
      records.forEach((record) => {
        addClosedTabToStore(record.tab, tabSpaceId, record.closedAt);
      });
    })
    .finally(() => {
      pendingSwitch = null;
    });
}

function addClosedTabToStore(
  tab: TabCore,
  tabSpaceId: string,
  closedAt: number,
) {
  const closedTab = newClosedTabFromTab(tab, tabSpaceId, closedAt);
  logger.log('closed tab recorded into history:', closedTab.url);
  localChangePending = true;
  closedTabStoreApi.addClosedTab(closedTab);
  void saveCurrentClosedTabs();
}

export function deleteClosedTab(tid: string) {
  localChangePending = true;
  closedTabStoreApi.removeClosedTab(tid);
  void saveCurrentClosedTabs();
}

export function clearAllClosedTabs() {
  const droppedIds = $allClosedTab
    .getState()
    .closedTabs.map((t) => t.id)
    .toArray();
  if (droppedIds.length <= 0) {
    return;
  }
  localChangePending = true;
  closedTabStoreApi.clearClosedTabs();
  void saveCurrentClosedTabs();
  logger.log('closed tab history cleared:', droppedIds.length, 'entries');
}

/** Re-opens a closed tab in this tabverse's window. */
export async function restoreClosedTab(closedTab: ClosedTab): Promise<boolean> {
  try {
    await chrome.tabs.create({ url: closedTab.url, active: true });
    return true;
  } catch (err) {
    logger.error('could not restore closed tab', closedTab.url, err);
    return false;
  }
}
