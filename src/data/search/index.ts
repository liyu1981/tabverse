import { Query } from './Query';
import { ServerApiClient, ServerApiError } from '../repo/serverApi';
import { StorageAreaLike } from '../repo/outbox';
import { loadSyncConfig } from '../repo/syncConfig';
import { logger } from '../../global';
import { searchLocalTabSpaceIds } from './localSearch';
import { searchServerTabSpaceIds } from './serverSearch';

import { TabSpace } from '../tabSpace/TabSpace';
import { loadTabSpacesByIds } from '../tabSpace/util';

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
