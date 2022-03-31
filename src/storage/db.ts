import { merge } from 'lodash';
import { isJestTest } from '../debug';
import { TabSpaceDatabase } from './TabSpaceDatabase';

export * from './TabSpaceDatabase';
export const db: TabSpaceDatabase = isJestTest()
  ? require('../dev/dbImplTest').dbImpl
  : require('./dbImpl').dbImpl;

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
