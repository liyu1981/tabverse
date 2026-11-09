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
import { isEqual, omit } from 'lodash';

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
      if (hasUnsavedLocalEdits()) {
        return;
      }
      logger.log('closed tab table changed, reloading the history');
      void loadClosedTabsByTabSpaceId($tabSpace.getState().id, {
        guardLocalEdits: true,
      });
    },
  );
}

/**
 * How many local edits the store holds, and how many of them the database is
 * known to have.
 *
 * These replaced a `localChangePending` boolean, and the reason matters: a
 * delete taken while a save was already in flight used to be undone by that
 * save, which ended by replacing the store with the snapshot it had written
 * (see `saveAllClosedTabsImpl`). A counter says *which* state is newer, so the
 * write of an older one never wins, and "the database does not have this yet"
 * stays true until the write that includes it lands - not until the first write
 * to finish.
 */
let localMutation = 0;
let savedMutation = 0;
let dbChangesMonitorStarted = false;

function noteLocalEdit(): void {
  localMutation += 1;
}

function hasUnsavedLocalEdits(): boolean {
  return localMutation > savedMutation;
}

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

/**
 * Replaces the store with what the database holds for this tabverse.
 *
 * `guardLocalEdits` is for the worker's "the table changed" notice: the read
 * takes a moment, and an edit the person made while it was in flight is newer
 * than the rows it comes back with. Dropping the read there is what stops a
 * just-deleted row from re-appearing under the cursor; the next notice (or the
 * next panel open) brings the table back in step.
 *
 * The other callers - opening the panel, the tabverse switch - want the table
 * as it is, and an edit landing during those is covered by the store side (the
 * save's own snapshot guard).
 */
export async function loadClosedTabsByTabSpaceId(
  tabSpaceId: string,
  options: { guardLocalEdits?: boolean } = {},
) {
  const startedAt = localMutation;
  const rows = await queryClosedTabs(tabSpaceId);
  if (options.guardLocalEdits === true && localMutation !== startedAt) {
    logger.log(
      'closed tab history changed while it was being read, dropping the read',
    );
    return;
  }
  closedTabStoreApi.update(allClosedTabFromRows(tabSpaceId, rows));
}

/** Everything a stored row means except when it was written. */
function isSameSavedClosedTab(
  stored: ClosedTab | undefined,
  next: ClosedTab,
): boolean {
  if (!stored) {
    return false;
  }
  return isEqual(omit(stored, 'updatedAt'), omit(next, 'updatedAt'));
}

async function saveAllClosedTabsImpl(): Promise<number> {
  const before = $allClosedTab.getState();
  const startedAt = localMutation;
  const { allClosedTab, closedTabSavePayloads } =
    convertAndGetClosedTabSavePayloads(before);
  const keptIds = new Set(allClosedTab.closedTabs.map((t) => t.id).toArray());
  // Pruning below deletes what the store no longer holds, which is only true of
  // the tabverse's history if the store is authoritative for it (see
  // AllClosedTab.mayPrune). A store that has only recorded closed tabs since
  // this page loaded - a reload, a restart, closing a tab before opening
  // History - holds one new row and knows nothing about the rest, and pruning
  // there would delete the tabverse's history and tombstone it to every device.
  // Writes still happen; only the deletes are withheld.
  const mayPrune =
    before.mayPrune && before.tabSpaceId === allClosedTab.tabSpaceId;
  const updatedAt = await db.transaction(
    'rw',
    [db.table(CLOSED_TAB_DB_TABLE_NAME)],
    async (_tx) => {
      // Only the rows whose content changed are written. A save re-stamps every
      // row it holds (`convertToSavedClosedTab`), so writing the whole list
      // makes each save look like an edit of all of them: up to 999 rows queued
      // for the server (several hundred kilobytes) because one page was
      // forgotten. That is also why the History panel used to be heavy after a
      // few deletes: each click paid for the whole history, on both ends.
      const storedRows = await db
        .table<ClosedTab>(CLOSED_TAB_DB_TABLE_NAME)
        .bulkGet(closedTabSavePayloads.map((row) => row.id));
      const changedRows = closedTabSavePayloads.filter(
        (row, index) => !isSameSavedClosedTab(storedRows[index], row),
      );
      if (changedRows.length > 0) {
        await db.table(CLOSED_TAB_DB_TABLE_NAME).bulkPut(changedRows);
      }
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
      const staleIds = mayPrune ? idsInDb.filter((id) => !keptIds.has(id)) : [];
      if (staleIds.length > 0) {
        await db.table(CLOSED_TAB_DB_TABLE_NAME).bulkDelete(staleIds);
      }
      return Date.now();
    },
  );
  if (localMutation === startedAt) {
    // The store has not moved since the snapshot: the saved copy is the truth.
    closedTabStoreApi.update(allClosedTab);
  } else {
    // An edit landed while this write was in flight. Its own save is already
    // scheduled, and replacing the store with the older snapshot here is what
    // resurrected a row the person had just deleted (the row was written back
    // on the next save, and pushed to the server, so it stayed).
    logger.log(
      'closed tab history changed while it was saved, keeping the newer store',
    );
  }
  savedMutation = Math.max(savedMutation, startedAt);
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
    closedTabStoreApi.markInSaving(false);
  }
};

const saveCurrentClosedTabs = debounce(
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
    //
    // An *empty* store does not need this: naming the tabverse leaves it
    // unauthorised to prune (see AllClosedTab.mayPrune), so the rows it has
    // never read survive.
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
  noteLocalEdit();
  closedTabStoreApi.addClosedTab(closedTab);
  void saveCurrentClosedTabs();
}

/**
 * Forgets one page from the history - **all** of its rows.
 *
 * The HISTORY is one row per url (`ClosedTab`: "closing the same page again
 * bumps `closedAt` instead of adding a row"), and this is the delete for that
 * model. It removes by url, not by id, because a second copy of the same page
 * can exist: another device closed it too, and its row arrives through sync
 * with its own id. Deleting by id left that copy on screen - the row looked
 * undeleted, and clicking again happened to work - so "forget it" forgets the
 * page.
 *
 * A row with no url (only old rows have one) is deleted by id.
 */
export function deleteClosedTab(closedTab: Pick<ClosedTab, 'id' | 'url'>) {
  noteLocalEdit();
  if (closedTab.url !== '') {
    closedTabStoreApi.removeClosedTabsByUrl(closedTab.url);
  } else {
    closedTabStoreApi.removeClosedTab(closedTab.id);
  }
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
  noteLocalEdit();
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
