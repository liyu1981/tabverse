import { createApi, createStore } from 'effector';
import { merge } from 'lodash';
import { exposeDebugData } from '../../debug';
import { LoadStatus, perfEnd, perfStart } from '../../global';
import { Query, SearchBackend, searchSavedTabSpaces } from '../search';
import { setAttrForObject } from '../common';
import { $tabSpaceStorage } from '../tabSpace/store';
import { TabSpace } from '../tabSpace/TabSpace';
import { querySavedTabSpace } from '../tabSpace/util';
import { queryOpenTabSpaces } from '../tabSpace/openTabverses';
import {
  newEmptyTabSpaceQuery,
  OpenedTabSpace,
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
});

async function reload() {
  tabSpaceQueryApi._setLoadStatus(LoadStatus.Loading);

  const tabSpaceQuery = $tabSpaceQuery.getState();

  // Every tabverse open in this profile, not just this window's own. One
  // chrome.tabs.query answers it, because every Tabverse tab carries its
  // tabverse id in its url as `tvid` (see openTabverses.ts) - no registry, no
  // bookkeeping. It matters because "is this open" decides what the detail view
  // offers: Load to New / Load to Current, or Switch. Getting it wrong opens a
  // second window on an id that is already open, and two pages holding one id
  // overwrite each other's tab list.
  const openInBrowser = await queryOpenTabSpaces();
  const openedSavedTabSpaces: OpenedTabSpace[] = openInBrowser.map((open) => ({
    id: open.tabSpaceId,
    chromeTabId: open.chromeTabId,
    chromeWindowId: open.chromeWindowId,
  }));
  let savedTabSpaces: TabSpace[];
  let changes: Record<string, any> = {};
  if (!tabSpaceQuery.query.isEmpty()) {
    perfStart('load:search');
    // The server's FTS5 index when this device is paired, the local tables
    // otherwise (ADR 0008). Either way the backend hands back a ranked list of
    // tabverse ids, already filtered to the ones this device has.
    const result = await searchSavedTabSpaces(tabSpaceQuery.query);
    savedTabSpaces = result.tabSpaces.slice(
      tabSpaceQuery.queryPageStart * tabSpaceQuery.queryPageLimit,
      (tabSpaceQuery.queryPageStart + 1) * tabSpaceQuery.queryPageLimit,
    );
    changes = {
      ...changes,
      totalPageCount: Math.ceil(
        result.tabSpaces.length / tabSpaceQuery.queryPageLimit,
      ),
      searchBackend: result.backend as SearchBackend,
      searchUnknownTabSpaceIds: result.unknownTabSpaceIds,
    };
    if (
      tabSpaceQuery.queryPageStart > 0 &&
      tabSpaceQuery.queryPageStart >= changes.totalPageCount
    ) {
      changes = {
        ...changes,
        queryPageStart: Math.max(0, changes.totalPageCount - 1),
      };
    }
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
    if (tabSpaceQuery.totalPageCount > 0) {
      tabSpaceQueryApi._setQueryPageStart(tabSpaceQuery.totalPageCount - 1);
      reload();
    }
  },
  firstPage: () => {
    tabSpaceQueryApi._setQueryPageStart(0);
    reload();
  },
});

exposeDebugData('tabSpaceQuery', {
  $tabSpaceQuery,
  tabSpaceQueryApi,
});
