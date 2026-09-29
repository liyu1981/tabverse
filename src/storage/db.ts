import { merge } from 'lodash';

import { dbImpl } from './dbImpl';
import { TabSpaceDatabase } from './TabSpaceDatabase';

export * from './TabSpaceDatabase';

// The single database handle. In unit tests the vitest config aliases
// `./dbImpl` onto src/dev/dbImplTest (fake-indexeddb) - a static import,
// so there is no CommonJS require() left in the bundle and the test
// database never leaks into the production build.
export const db: TabSpaceDatabase = dbImpl;

export const QUERY_PAGE_LIMIT_DEFAULT = 10; // 2;

export function addPagingToQueryParams(
  params: any,
  start?: number,
  limit?: number,
) {
  return merge(params, {
    pageStart: start ?? 0,
    pageLimit: limit ?? QUERY_PAGE_LIMIT_DEFAULT,
  });
}
