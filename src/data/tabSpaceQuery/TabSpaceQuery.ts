import { fromNow } from '../../time';
import { EmptyQuery, Query } from '../search/Query';
import { SearchBackend } from '../search';

import { LoadStatus } from '../../global';
import { QUERY_PAGE_LIMIT_DEFAULT } from '../../storage/db';
import { TabSpace } from '../tabSpace/TabSpace';
import { produce } from 'immer';

export enum SortMethods {
  CREATED = 0,
  SAVED = 1,
}

/**
 * A saved tabverse that is open in *this* window. Each manager page owns one
 * window, so a profile can have several of these open at once (one per window)
 * but a single page only ever sees its own - the list is built in the store,
 * not queried.
 */
export interface OpenedTabSpace {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  chromeTabId: number;
  chromeWindowId: number;
}

export interface TabSpaceQuery {
  loadStatus: LoadStatus;
  openedSavedTabSpaces: OpenedTabSpace[];
  savedTabSpaces: TabSpace[];
  sortMethod: SortMethods;
  totalPageCount: number;
  query: Query;
  /**
   * Which backend answered the current search: the server's FTS5 index, or
   * the local table scan. Shown in the UI, because they do not match exactly
   * (see ADR 0008).
   */
  searchBackend: SearchBackend | null;
  /** Ids the backend matched that this device has not downloaded. */
  searchUnknownTabSpaceIds: string[];
  // paging is the same for browsing and for searching: the result is a list of
  // tabverse ids either way (ADR 0008 dropped the index cursor)
  queryPageStart: number;
  queryPageLimit: number;
}

export function newEmptyTabSpaceQuery(): TabSpaceQuery {
  return {
    loadStatus: LoadStatus.Done,
    openedSavedTabSpaces: [],
    savedTabSpaces: [],
    sortMethod: SortMethods.SAVED,
    totalPageCount: 0,
    query: EmptyQuery,
    searchBackend: null,
    searchUnknownTabSpaceIds: [],
    queryPageStart: 0,
    queryPageLimit: QUERY_PAGE_LIMIT_DEFAULT,
  };
}

export function isSearchMode(targetTabSpaceQuery: TabSpaceQuery): boolean {
  return !targetTabSpaceQuery.query.isEmpty();
}

export function getSortedGroupedSavedTabSpaces(
  targetTabSpaceQuery: TabSpaceQuery,
): [string, [string, TabSpace[]][]] {
  const clonedSavedTabSpaces = targetTabSpaceQuery.savedTabSpaces.slice(0);
  targetTabSpaceQuery.sortMethod === SortMethods.SAVED
    ? clonedSavedTabSpaces.sort((a, b) => b.updatedAt - a.updatedAt)
    : clonedSavedTabSpaces.sort((a, b) => b.createdAt - a.createdAt);

  const result = clonedSavedTabSpaces.reduce((groups, savedTabSpace) => {
    const m = fromNow(
      targetTabSpaceQuery.sortMethod === SortMethods.SAVED
        ? savedTabSpace.updatedAt
        : savedTabSpace.createdAt,
    );
    if (groups.length <= 0) {
      groups.push([m, [savedTabSpace]]);
    } else {
      const [lastGroupM, lastGroup] = groups[groups.length - 1];
      if (lastGroupM !== m) {
        groups.push([m, [savedTabSpace]]);
      } else {
        lastGroup.push(savedTabSpace);
      }
    }
    return groups;
  }, []) as [string, TabSpace[]][];

  return [
    targetTabSpaceQuery.sortMethod === SortMethods.SAVED ? 'saved' : 'created',
    result,
  ];
}

export function isTabSpaceOpened(
  tabSpaceId: string,
  targetTabSpaceQuery: TabSpaceQuery,
): boolean {
  return (
    targetTabSpaceQuery.openedSavedTabSpaces.findIndex(
      (tabSpaceStud) => tabSpaceStud.id === tabSpaceId,
    ) >= 0
  );
}

export function setQuery(
  query: Query,
  targetTabSpaceQuery: TabSpaceQuery,
): TabSpaceQuery {
  return produce(targetTabSpaceQuery, (draft) => {
    // a new query starts at the first page; paging past the end is clamped
    // again once the result count is known
    draft.queryPageStart = 0;
    draft.queryPageLimit = QUERY_PAGE_LIMIT_DEFAULT;
    draft.searchBackend = null;
    draft.searchUnknownTabSpaceIds = [];
    draft.query = query;
  });
}
