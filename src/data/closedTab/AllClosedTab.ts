import {
  ClosedTab,
  HISTORY_MAX_ENTRIES,
  convertToSavedClosedTab,
  setTabSpaceId,
} from './ClosedTab';
import { IBase, isIdNotSaved } from '../common';
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
}

export function newEmptyAllClosedTab(): AllClosedTab {
  return {
    ...newEmptyBase(),
    tabSpaceId: NotTabSpaceId,
    closedTabs: List(),
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
  });
}

export function clearClosedTabs(target: AllClosedTab): AllClosedTab {
  return produce(target, (draft) => {
    draft.closedTabs = List();
  });
}

export function updateTabSpaceId(
  tabSpaceId: string,
  target: AllClosedTab,
): AllClosedTab {
  return produce(target, (draft) => {
    draft.tabSpaceId = tabSpaceId;
    draft.closedTabs = draft.closedTabs
      .map((closedTab) => setTabSpaceId(tabSpaceId, closedTab))
      .toList();
  });
}

export function convertAndGetClosedTabSavePayloads(target: AllClosedTab): {
  allClosedTab: AllClosedTab;
  newClosedTabSavePayloads: ClosedTab[];
  existClosedTabSavePayloads: ClosedTab[];
} {
  const newClosedTabSavePayloads: ClosedTab[] = [];
  const existClosedTabSavePayloads: ClosedTab[] = [];
  const savedClosedTabs = target.closedTabs
    .map((closedTab) => {
      const savedClosedTab = convertToSavedClosedTab(closedTab);
      if (isIdNotSaved(closedTab.id)) {
        newClosedTabSavePayloads.push(savedClosedTab);
      } else {
        existClosedTabSavePayloads.push(savedClosedTab);
      }
      return savedClosedTab;
    })
    .toList();
  // the aggregate is store-only (there is no SavedAllClosedTab row), so only
  // the entries get their durable ids here
  return {
    allClosedTab: produce(target, (draft) => {
      draft.closedTabs = savedClosedTabs;
    }),
    newClosedTabSavePayloads,
    existClosedTabSavePayloads,
  };
}

/** Rebuilds the store view from flat rows (load path). */
export function allClosedTabFromRows(
  tabSpaceId: string,
  rows: ClosedTab[],
): AllClosedTab {
  return produce(newEmptyAllClosedTab(), (draft) => {
    draft.tabSpaceId = tabSpaceId;
    draft.closedTabs = sortByClosedAt(List(rows)).slice(0, HISTORY_MAX_ENTRIES);
  });
}
