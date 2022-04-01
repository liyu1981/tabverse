import { createApi, createStore } from 'effector';
import { merge } from 'lodash';
import { searchSavedTabSpace } from '../../background/fullTextSearch/search';
import { exposeDebugData } from '../../debug';
import { Query } from '../../fullTextSearch';
import { LoadStatus, perfEnd, perfStart } from '../../global';
import { isIdNotSaved, setAttrForObject } from '../common';
import { getStateTabSpaceRegistry } from '../tabSpaceRegistry/store';
import { $tabSpaceStorage } from '../tabSpace/store';
import { TabSpace } from '../tabSpace/TabSpace';
import { querySavedTabSpace } from '../tabSpace/util';
import {
  newEmptyTabSpaceQuery,
  setQuery,
  SortMethods,
  TabSpaceQuery,
} from './TabSpaceQuery';
import { addPagingToQueryParams } from '../../storage/db';

export const $tabSpaceQuery = createStore(newEmptyTabSpaceQuery());

const tabSpaceQueryApi = createApi($tabSpaceQuery, {
  update: (lastTabSpaceQuery, updatedTabSpaceQuery: TabSpaceQuery) =>
    updatedTabSpaceQuery,
  _setLoadStatus: (lastTabSpaceQuery, loadStatus: LoadStatus) =>
    setAttrForObject('loadStatus', loadStatus, lastTabSpaceQuery),
  _setSortMethod: (lastTabSpaceQuery, sortMethod: SortMethods) =>
    setAttrForObject('sortMethod', sortMethod, lastTabSpaceQuery),
  _setQuery: (lastTabSpaceQuery, query: Query) =>
    setQuery(query, lastTabSpaceQuery),
  _setQueryPageStart: (lastTabSpaceQuery, queryPageStart: number) =>
    setAttrForObject('queryPageStart', queryPageStart, lastTabSpaceQuery),
  _setQueryPageLimit: (lastTabSpaceQuery, queryPageLimit: number) =>
    setAttrForObject('queryPageLimit', queryPageLimit, lastTabSpaceQuery),
  _setQueryCursorCurrentIndex: (
    lastTabSpaceQuery,
    queryCursorCurrentIndex: number,
  ) =>
    setAttrForObject(
      'queryCursorCurrentIndex',
      queryCursorCurrentIndex,
      lastTabSpaceQuery,
    ),
});

async function reload() {
  tabSpaceQueryApi._setLoadStatus(LoadStatus.Loading);

  const tabSpaceQuery = $tabSpaceQuery.getState();

  const openedSavedTabSpaces = getStateTabSpaceRegistry()
    .filter((tabSpaceStub) => !isIdNotSaved(tabSpaceStub.id))
    .toArray();
  let savedTabSpaces: TabSpace[] = [];
  let changes: Record<string, any> = {};
  if (!tabSpaceQuery.query.isEmpty()) {
    perfStart('load:search');
    const currentCursor =
      tabSpaceQuery.queryCursors[tabSpaceQuery.queryCursorCurrentIndex];
    const [_savedTabSpaces, _nextCursor] = await searchSavedTabSpace({
      query: tabSpaceQuery.query,
      cursor: currentCursor,
    });
    // @ts-ignore
    savedTabSpaces = _savedTabSpaces;
    if (
      !tabSpaceQuery.queryCursorsVisited[tabSpaceQuery.queryCursorCurrentIndex]
    ) {
      changes = {
        ...changes,
        queryCursors: tabSpaceQuery.queryCursors.concat(_nextCursor),
      };
    }
    changes = {
      ...changes,
      queryCursorsVisited: {
        ...tabSpaceQuery.queryCursorsVisited,
        [tabSpaceQuery.queryCursorCurrentIndex]: true,
      },
    };
    perfEnd('load:search');
  } else {
    perfStart('load:browse');
    const savedTabSpaceParams = addPagingToQueryParams(
      {},
      tabSpaceQuery.queryPageStart * tabSpaceQuery.queryPageLimit,
      tabSpaceQuery.queryPageLimit,
    );
    const totalCount = $tabSpaceStorage.getState().totalSavedCount;
    savedTabSpaces = await querySavedTabSpace(savedTabSpaceParams);
    changes = {
      ...changes,
      totalPageCount: Math.ceil(totalCount / tabSpaceQuery.queryPageLimit),
    };
    if (tabSpaceQuery.queryPageStart >= changes.totalPageCount) {
      changes = {
        ...changes,
        queryPageStart: changes.totalPageCount - 1,
      };
    }
    changes = {
      ...changes,
      totalPageCount: Math.ceil(totalCount / tabSpaceQuery.queryPageLimit),
    };
    if (tabSpaceQuery.queryPageStart >= changes.totalPageCount) {
      changes = {
        ...changes,
        queryPageStart: changes.totalPageCount - 1,
      };
    }
    perfEnd('load:browse');
  }

  tabSpaceQueryApi.update({
    ...tabSpaceQuery,
    openedSavedTabSpaces,
    savedTabSpaces,
    ...changes,
  });

  tabSpaceQueryApi._setLoadStatus(LoadStatus.Done);
}

export const tabSpaceQueryStoreApi = merge(tabSpaceQueryApi, {
  reload: () => reload(),
  setSortMethod: (value: SortMethods) => {
    tabSpaceQueryApi._setSortMethod(value);
    reload();
  },
  setQuery: (value: Query) => {
    tabSpaceQueryApi._setQuery(value);
    reload();
  },
  setQueryPageStart: (value: number) => {
    tabSpaceQueryApi._setQueryPageStart(value);
    reload();
  },
  setQueryPageLimit: (value: number) => {
    tabSpaceQueryApi._setQueryPageLimit(value);
    reload();
  },
  nextPage: () => {
    const tabSpaceQuery = $tabSpaceQuery.getState();
    if (tabSpaceQuery.queryPageStart < tabSpaceQuery.totalPageCount - 1) {
      tabSpaceQueryApi._setQueryPageStart(tabSpaceQuery.queryPageStart + 1);
      reload();
    }
  },
  prevPage: () => {
    const tabSpaceQuery = $tabSpaceQuery.getState();
    if (tabSpaceQuery.queryPageStart >= 1) {
      tabSpaceQueryApi._setQueryPageStart(tabSpaceQuery.queryPageStart - 1);
      reload();
    }
  },
  lastPage: () => {
    const tabSpaceQuery = $tabSpaceQuery.getState();
    tabSpaceQueryApi._setQueryPageStart(tabSpaceQuery.totalPageCount - 1);
    reload();
  },
  firstPage: () => {
    tabSpaceQueryApi._setQueryPageStart(0);
    reload();
  },
  goQueryCursor: (cursorIndex: number) => {
    const tabSpaceQuery = $tabSpaceQuery.getState();
    if (cursorIndex >= 0 && cursorIndex < tabSpaceQuery.queryCursors.length) {
      tabSpaceQueryApi._setQueryCursorCurrentIndex(cursorIndex);
      reload();
    }
  },
  goQueryCursorNext() {
    const tabSpaceQuery = $tabSpaceQuery.getState();
    if (tabSpaceQuery.queryCursors.length >= 1) {
      tabSpaceQueryApi._setQueryCursorCurrentIndex(
        this.queryCursors.length - 1,
      );
      reload();
    }
  },
});

exposeDebugData('tabSpaceQuery', {
  $tabSpaceQuery,
  tabSpaceQueryApi,
});
