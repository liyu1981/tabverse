import { IBase, setAttrForObject2 } from '../common';
import { inPlaceConvertToSaved, newEmptyBase } from '../Base';

import { NotTabSpaceId } from '../common';
import { TabCore } from '../tabSpace/Tab';
import { produce } from 'immer';

/**
 * A tab that was closed in this tabverse.
 *
 * One row per url: closing the same page again bumps `closedAt` instead of
 * adding a row (see `addClosedTab`), so the list stays "pages you closed",
 * not "close events".
 */
export interface ClosedTab extends IBase {
  tabSpaceId: string;
  title: string;
  url: string;
  favIconUrl: string;
  /** When the tab was closed the latest time, unix ms. Sort key. */
  closedAt: number;
  /** How many times this url was closed in this tabverse. */
  timesClosed: number;
}

export const CLOSED_TAB_DB_TABLE_NAME = 'SavedClosedTab';
export const CLOSED_TAB_DB_SCHEMA = 'id, tabSpaceId, closedAt';

/**
 * How many closed tabs one tabverse remembers. The oldest entries are pruned
 * once the cap is reached. 999 is a deliberate "three digits" number: a
 * tabverse that is closed a hundred times a day still holds about a week of
 * history, and 1000 rows of ~200 bytes is nothing next to a single tab
 * thumbnail.
 */
export const HISTORY_MAX_ENTRIES = 999;

export function newEmptyClosedTab(): ClosedTab {
  return {
    ...newEmptyBase(),
    tabSpaceId: NotTabSpaceId,
    title: '',
    url: '',
    favIconUrl: '',
    closedAt: Date.now(),
    timesClosed: 1,
  };
}

export const setTabSpaceId = setAttrForObject2<string, ClosedTab>('tabSpaceId');
export const setTitle = setAttrForObject2<string, ClosedTab>('title');
export const setUrl = setAttrForObject2<string, ClosedTab>('url');
export const setFavIconUrl = setAttrForObject2<string, ClosedTab>('favIconUrl');

export function convertToSavedClosedTab(targetClosedTab: ClosedTab): ClosedTab {
  return produce(targetClosedTab, (draft) => {
    inPlaceConvertToSaved(draft);
  });
}

/** Builds a history entry out of a tab that just left the tabverse. */
export function newClosedTabFromTab(
  tab: TabCore,
  tabSpaceId: string,
  closedAt: number = Date.now(),
): ClosedTab {
  return produce(newEmptyClosedTab(), (draft) => {
    draft.tabSpaceId = tabSpaceId;
    draft.title = tab.title;
    draft.url = tab.url;
    draft.favIconUrl = tab.favIconUrl;
    draft.closedAt = closedAt;
    draft.timesClosed = 1;
  });
}
