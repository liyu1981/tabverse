import {
  ClosedTab,
  HISTORY_MAX_ENTRIES,
  convertToSavedClosedTab,
  setTabSpaceId,
} from './ClosedTab';
import { IBase } from '../common';
import { newEmptyBase } from '../Base';

import { List } from 'immutable';
import { NotTabSpaceId } from '../common';
import { produce } from 'immer';

/**
 * The in-memory view of one tabverse's closed tabs, newest first.
 *
 * Unlike AllNote/AllTodo/AllBookmark this has *no* `SavedAllClosedTab` table:
 * the list is append-mostly and its order is `closedAt` desc, which the rows
 * carry themselves, so there is no user-made ordering to preserve and no
 * aggregate row to sync. Rows are stored flat in `SavedClosedTab` and queried
 * by `tabSpaceId`.
 */
export interface AllClosedTab extends IBase {
  tabSpaceId: string;
  closedTabs: List<ClosedTab>;
  /**
   * Whether a save may delete rows of this tabverse that the store does not
   * hold. That sweep is how "forget this one", "clear all" and the history cap
   * prune - and it is only ever true of rows the store is authoritative about.
   *
   * Two things make a store authoritative: it has *read* the tabverse's history
   * (`allClosedTabFromRows`), or the user has just said a row is gone
   * (`removeClosedTab`, `clearClosedTabs`). Merely recording closed tabs is
   * neither: on a page that has just loaded - a reload, a browser restart - the
   * store holds one new row and knows nothing about the rest, and pruning there
   * takes the tabverse's history with it. Those deletes are not local either:
   * they go to the server as tombstones, so every device loses the rows too.
   *
   * False is the honest default: nothing has been read and nothing was deleted.
   */
  mayPrune: boolean;
}

export function newEmptyAllClosedTab(): AllClosedTab {
  return {
    ...newEmptyBase(),
    tabSpaceId: NotTabSpaceId,
    closedTabs: List(),
    mayPrune: false,
  };
}

/** Newest first. */
export function sortByClosedAt(closedTabs: List<ClosedTab>): List<ClosedTab> {
  return closedTabs.sort(
    (a, b) => b.closedAt - a.closedAt || b.createdAt - a.createdAt,
  );
}

function entryOfSameUrl(
  closedTabs: List<ClosedTab>,
  closedTab: ClosedTab,
): ClosedTab | undefined {
  return closedTabs.find((t) => t.url === closedTab.url && t.url.length > 0);
}

/**
 * Records a closed tab, and returns the new list.
 *
 * Closing a url that is already in the history moves that entry to the top and
 * bumps its counter instead of adding a second row; anything past
 * HISTORY_MAX_ENTRIES is dropped from the returned list, and the caller is
 * responsible for deleting the rows that fell off (see saveAllClosedTabs in
 * util.ts).
 */
export function addClosedTab(
  closedTab: ClosedTab,
  target: AllClosedTab,
): AllClosedTab {
  return produce(target, (draft) => {
    const inSameTabSpace = setTabSpaceId(draft.tabSpaceId, closedTab);
    const existing = entryOfSameUrl(draft.closedTabs, inSameTabSpace);
    if (existing) {
      draft.closedTabs = draft.closedTabs
        .map((t) =>
          t.id === existing.id
            ? {
                ...t,
                // the newest page state wins: a page closed earlier in the day
                // may have had a different title then
                title: inSameTabSpace.title || t.title,
                favIconUrl: inSameTabSpace.favIconUrl || t.favIconUrl,
                closedAt: Math.max(t.closedAt, inSameTabSpace.closedAt),
                timesClosed: t.timesClosed + 1,
              }
            : t,
        )
        .toList();
    } else {
      draft.closedTabs = draft.closedTabs.push(inSameTabSpace);
    }
    draft.closedTabs = sortByClosedAt(draft.closedTabs).slice(
      0,
      HISTORY_MAX_ENTRIES,
    );
  });
}

export function updateClosedTab(
  tid: string,
  changes: Partial<ClosedTab>,
  target: AllClosedTab,
): AllClosedTab {
  return produce(target, (draft) => {
    const index = draft.closedTabs.findIndex((t) => t.id === tid);
    if (index >= 0) {
      draft.closedTabs = sortByClosedAt(
        draft.closedTabs.set(index, {
          ...draft.closedTabs.get(index),
          ...changes,
        }),
      );
    }
  });
}

export function removeClosedTab(
  tid: string,
  target: AllClosedTab,
): AllClosedTab {
  return produce(target, (draft) => {
    draft.closedTabs = draft.closedTabs.filter((t) => t.id !== tid).toList();
    // the user said this row is gone, so the save may prune it from the
    // database even if this store never read the tabverse's history
    draft.mayPrune = true;
  });
}

export function clearClosedTabs(target: AllClosedTab): AllClosedTab {
  return produce(target, (draft) => {
    draft.closedTabs = List();
    draft.mayPrune = true;
  });
}

export function updateTabSpaceId(
  tabSpaceId: string,
  target: AllClosedTab,
): AllClosedTab {
  return produce(target, (draft) => {
    draft.tabSpaceId = tabSpaceId;
    // naming the tabverse is not reading it, and it is not a deletion either
    draft.mayPrune = false;
    draft.closedTabs = draft.closedTabs
      .map((closedTab) => setTabSpaceId(tabSpaceId, closedTab))
      .toList();
  });
}

/**
 * The rows to write. The aggregate is store-only (there is no SavedAllClosedTab
 * row), so only the entries are saved, and every id is final from creation, so
 * one bulkPut covers both a first write and an update.
 */
export function convertAndGetClosedTabSavePayloads(target: AllClosedTab): {
  allClosedTab: AllClosedTab;
  closedTabSavePayloads: ClosedTab[];
} {
  const savedClosedTabs = target.closedTabs
    .map(convertToSavedClosedTab)
    .toList();
  return {
    allClosedTab: produce(target, (draft) => {
      draft.closedTabs = savedClosedTabs;
    }),
    closedTabSavePayloads: savedClosedTabs.toArray(),
  };
}

/** Rebuilds the store view from flat rows (load path). */
export function allClosedTabFromRows(
  tabSpaceId: string,
  rows: ClosedTab[],
): AllClosedTab {
  return produce(newEmptyAllClosedTab(), (draft) => {
    draft.tabSpaceId = tabSpaceId;
    // read from the database, so the store is authoritative for this tabverse
    draft.mayPrune = true;
    draft.closedTabs = sortByClosedAt(List(rows)).slice(0, HISTORY_MAX_ENTRIES);
  });
}
