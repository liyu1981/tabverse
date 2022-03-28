import {
  calcCursorBegin,
  EmptyQuery,
  IFullTextSearchCursor,
  Query,
} from '../../fullTextSearch';
import { LoadStatus } from '../../global';
import { QUERY_PAGE_LIMIT_DEFAULT } from '../../store/storage';

import Moment from 'moment';
import { TabSpace } from '../tabSpace/TabSpace';
import { TabSpaceStub } from '../tabSpaceRegistry/TabSpaceRegistry';

export enum SortMethods {
  CREATED = 0,
  SAVED = 1,
}

export interface TabSpaceQuery {
  loadStatus: LoadStatus;
  openedSavedTabSpaces: TabSpaceStub[];
  savedTabSpaces: TabSpace[];
  sortMethod: SortMethods;
  totalPageCount: number;
  query: Query;
  // when query is not empty we will use queryCursorPrev & queryCursorNext
  queryCursors: IFullTextSearchCursor[];
  queryCursorCurrentIndex: number;
  queryCursorsVisited: { [index: number]: boolean };
  queryCursorsLocked: boolean;
  // when query is empty we will use queryPageStart & queryPageLimit
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
    queryCursors: [],
    queryCursorCurrentIndex: 0,
    queryCursorsVisited: {},
    queryCursorsLocked: false,
    queryPageStart: 0,
    queryPageLimit: QUERY_PAGE_LIMIT_DEFAULT,
  };
}

export function cloneTabSpaceQuery(
  targetTabSpaceQuery: TabSpaceQuery,
): TabSpaceQuery {
  return {
    ...targetTabSpaceQuery,
    query: new Query(targetTabSpaceQuery.query.toJSON()),
  };
}

export function isEmpty(targetTabSpaceQuery: TabSpaceQuery): boolean {
  return (
    targetTabSpaceQuery.openedSavedTabSpaces.length > 0 ||
    targetTabSpaceQuery.savedTabSpaces.length > 0
  );
}

export function isSearchMode(targetTabSpaceQuery: TabSpaceQuery): boolean {
  return !targetTabSpaceQuery.query.isEmpty();
}

export function getSortedOpenedSavedTabSpaces(
  targetTabSpaceQuery: TabSpaceQuery,
): TabSpaceStub[] {
  const clonedOpenedSavedTabSpaces =
    targetTabSpaceQuery.openedSavedTabSpaces.slice(0);
  targetTabSpaceQuery.sortMethod === SortMethods.SAVED
    ? clonedOpenedSavedTabSpaces.sort((a, b) => b.updatedAt - a.updatedAt)
    : clonedOpenedSavedTabSpaces.sort((a, b) => b.createdAt - a.createdAt);
  return clonedOpenedSavedTabSpaces;
}

export function getSortedGroupedSavedTabSpaces(
  targetTabSpaceQuery: TabSpaceQuery,
): [string, [string, TabSpace[]][]] {
  const clonedSavedTabSpaces = targetTabSpaceQuery.savedTabSpaces.slice(0);
  targetTabSpaceQuery.sortMethod === SortMethods.SAVED
    ? clonedSavedTabSpaces.sort((a, b) => b.updatedAt - a.updatedAt)
    : clonedSavedTabSpaces.sort((a, b) => b.createdAt - a.createdAt);

  const result = clonedSavedTabSpaces.reduce((groups, savedTabSpace) => {
    const m = Moment(
      targetTabSpaceQuery.sortMethod === SortMethods.SAVED
        ? savedTabSpace.updatedAt
        : savedTabSpace.createdAt,
    ).fromNow();
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

export function getCursorsForSearchPaging(targetTabSpaceQuery: TabSpaceQuery): {
  availableCursors: IFullTextSearchCursor[];
  currentCursor: IFullTextSearchCursor | null;
  currentCursorIndex: number | null;
  nextCursor: IFullTextSearchCursor | null;
} {
  const currentCursor =
    targetTabSpaceQuery.queryCursorCurrentIndex <
    targetTabSpaceQuery.queryCursors.length
      ? targetTabSpaceQuery.queryCursors[
          targetTabSpaceQuery.queryCursorCurrentIndex
        ]
      : null;
  const nextCursor =
    targetTabSpaceQuery.queryCursors.length >= 1
      ? targetTabSpaceQuery.queryCursors[
          targetTabSpaceQuery.queryCursors.length - 1
        ]
      : null;
  // copy from 0 to 2nd last cursors, as the last one is next cursor
  const availableCursors = targetTabSpaceQuery.queryCursors.slice(0, -1);
  return {
    availableCursors,
    currentCursor,
    currentCursorIndex:
      currentCursor === null
        ? null
        : targetTabSpaceQuery.queryCursorCurrentIndex,
    nextCursor,
  };
}

export function getShouldShowSearchPaging(
  targetTabSpaceQuery: TabSpaceQuery,
): boolean {
  if (targetTabSpaceQuery.queryCursors.length <= 0) {
    return false;
  } else {
    const nextCursor =
      targetTabSpaceQuery.queryCursors[
        targetTabSpaceQuery.queryCursors.length - 1
      ];
    if (
      targetTabSpaceQuery.queryCursors.length <= 2 &&
      nextCursor.hasMorePage === false
    ) {
      return false; // single page result case
    } else {
      return true;
    }
  }
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
  let changes = {};
  if (query.isEmpty()) {
    changes = {
      queryPageStart: 0,
      queryPageLimit: QUERY_PAGE_LIMIT_DEFAULT,
    };
  } else {
    changes = {
      queryCursors: [calcCursorBegin(query, QUERY_PAGE_LIMIT_DEFAULT)],
      queryCursorCurrentIndex: 0,
      queryCursorsVisited: {},
    };
  }
  return { ...targetTabSpaceQuery, query, ...changes };
}
