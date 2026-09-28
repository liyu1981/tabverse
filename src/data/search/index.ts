import { Query } from './Query';
import { ServerApiClient, ServerApiError } from '../repo/serverApi';
import { StorageAreaLike } from '../repo/outbox';
import { loadSyncConfig } from '../repo/syncConfig';
import { logger } from '../../global';
import { searchLocalTabSpaceIds } from './localSearch';
import { searchServerTabSpaceIds } from './serverSearch';

import {
  TAB_DB_TABLE_NAME,
  TabSavePayload,
  fromSavedTab,
} from '../tabSpace/Tab';
import {
  TABSPACE_DB_TABLE_NAME,
  TabSpace,
  TabSpaceSavePayload,
  fromSavedDataWithoutTabs,
  insertTab,
} from '../tabSpace/TabSpace';
import { db } from '../../storage/db';

export * from './Query';
export * from './localSearch';
export * from './searchable';
export * from './serverSearch';

export type SearchBackend = 'server' | 'local';

export interface SearchSavedTabSpacesOptions {
  /** Where the pairing config lives; injected in tests. */
  storage?: StorageAreaLike;
  /** Injected in tests, and the seam that keeps this module off the network. */
  fetchFn?: any;
  limit?: number;
}

export interface SearchSavedTabSpacesResult {
  /** Matching tabverses, in the backend's relevance order. */
  tabSpaces: TabSpace[];
  backend: SearchBackend;
  /** Ids the backend matched that this device has not downloaded. */
  unknownTabSpaceIds: string[];
}

/**
 * Loads tabverses by id, with their tabs, keeping the given order.
 *
 * `querySavedTabSpace({anyOf})` sorts by creation date and pages, which is
 * what the browse list wants and the opposite of what a ranked search wants.
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

/**
 * Searches saved tabverses.
 *
 * With a paired server the search is the server's FTS5 index, which knows
 * every tabverse of the account, not just the ones this device has pulled.
 * Without one - or when the server cannot answer - it falls back to scanning
 * the local tables (see localSearch.ts). Either way the result is filtered
 * against what is in this browser's database, because every hit is rendered
 * as a tabverse with its tabs.
 */
export async function searchSavedTabSpaces(
  query: Query,
  options: SearchSavedTabSpacesOptions = {},
): Promise<SearchSavedTabSpacesResult> {
  if (query.isEmpty()) {
    return { tabSpaces: [], backend: 'local', unknownTabSpaceIds: [] };
  }

  let ids: string[] = [];
  let backend: SearchBackend = 'local';
  // a missing or unreadable pairing config is not an error, it just means
  // there is no server to ask
  let config = null;
  try {
    config = await loadSyncConfig(options.storage);
  } catch (err) {
    logger.log('could not read the sync config, searching locally:', err);
  }
  if (config?.enabled) {
    try {
      const api = new ServerApiClient({
        baseUrl: config.baseUrl,
        token: config.token,
        fetchFn: options.fetchFn,
      });
      ids = await searchServerTabSpaceIds(api, query, options.limit);
      backend = 'server';
    } catch (err) {
      // A server that is down, unreachable or out of date must not make the
      // search box useless: the local scan is always available.
      logger.log(
        'server search failed, falling back to a local search:',
        err instanceof ServerApiError ? err.code : err,
      );
      ids = await searchLocalTabSpaceIds(query);
      backend = 'local';
    }
  } else {
    ids = await searchLocalTabSpaceIds(query);
  }

  const tabSpaces = await loadTabSpacesByIds(ids);
  const found = new Set(tabSpaces.map((tabSpace) => tabSpace.id));
  return {
    tabSpaces,
    backend,
    unknownTabSpaceIds: ids.filter((id) => !found.has(id)),
  };
}
