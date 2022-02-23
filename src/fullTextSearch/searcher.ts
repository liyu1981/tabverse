import { AndQuery, FIELD_ALL, TYPE_ALL } from '.';
import { Collection, IndexableType } from 'dexie';
import {
  FullTextSearchDatabase,
  INDEX_TABLE_NAME,
} from './FullTextSearchDatabase';
import { hasOwnProperty, logger, perfEnd, perfStart } from '../global';

import { IFullTextSearchIndexRecord } from './FullTextSearchDatabase';
import { Query } from './query';

export interface IFullTextSearchQuery {
  query: Query;
  cursor: IFullTextSearchCursor;
}

export interface IFullTextSearchCursor {
  next: string;
  hasMorePage: boolean;
}

export interface IFullTextSearchResult {
  results: IFullTextSearchIndexRecord[];
  nextCursor: IFullTextSearchCursor;
}

type DecodedCursorNext = {
  query: Query;
  nextQueryIndex: number;
  pageStart: number;
  pageLimit: number;
};

export const PAGE_LIMIT_DEFAULT = 2;
const NullCursor = { next: '', hasMorePage: false };

function createQueryForAndQuery(
  db: FullTextSearchDatabase,
  andQuery: AndQuery,
): Collection<IFullTextSearchIndexRecord, IndexableType> | null {
  if (andQuery.terms.length <= 0) {
    return null;
  }

  const sortedTerms = andQuery.terms.sort();

  let q = db
    .table<IFullTextSearchIndexRecord>(INDEX_TABLE_NAME)
    .where('terms')
    .equals(sortedTerms[0]);

  for (let i = 1; i < sortedTerms.length; i++) {
    const term = sortedTerms[i];
    q = q.and((x) => x.terms.findIndex((v) => v === term) >= 0);
  }

  if (hasOwnProperty(andQuery, 'type') && andQuery.type !== TYPE_ALL) {
    q = q.filter((record) => record.type === andQuery.type);
  }

  if (hasOwnProperty(andQuery, 'field') && andQuery.field !== FIELD_ALL) {
    q = q.filter((record) => record.field === andQuery.field);
  }

  return q;
}

/* our search algorithm: the query is assumed always with the form: `[terms10,
 * terms11, ...] or [terms20, terms21, ...] or [...]`
 *
 * we will create each `[terms10, ...]` a query for each and terms: q1, q2, q3,
 * ...
 *
 * 1. we then try to first query q1 start from pageStart and for as many as
 *    pageLimit entries, if we reach the pageLimit, then stop and output
 *
 * 2. otherwise if we have not reach the pageLimit, we will turn to q2, start
 *    from (pageStart - results.length), and for as many as pageLimit entries,
 *    and again if we reach the pageLimit, then stop and output
 *
 * 3. otherwise we will turn to q3, similar to last step until we reach the
 *    pageLimit or saturated all queries.
 */
export async function search(
  db: FullTextSearchDatabase,
  query: IFullTextSearchQuery,
): Promise<IFullTextSearchResult> {
  if (query.query.isEmpty() || !query.cursor.hasMorePage) {
    return {
      results: [],
      nextCursor: { next: '', hasMorePage: false },
    };
  }

  perfStart('fulltext:search');
  const queries = query.query.andQueries.map((andQuery) =>
    createQueryForAndQuery(db, andQuery),
  );

  let queryCursorNext: DecodedCursorNext = null;
  try {
    queryCursorNext = decodeCursorNext(query.cursor.next);
  } catch (e) {
    logger.error('decodeCursorNext failed:', e);
    return {
      results: [],
      nextCursor: NullCursor,
    };
  }

  let results = [];
  let nextCursor = NullCursor;
  let pageStart = queryCursorNext.pageStart;
  const pageLimit = queryCursorNext.pageLimit;
  let qResults = [];
  let qResultsLeftCount = 0;

  for (let i = queryCursorNext.nextQueryIndex; i < queries.length; i++) {
    let q = queries[i];
    if (q) {
      // by limit as 2*pageLimit we will know whether there is next page without
      // query everything
      q = q.offset(pageStart * pageLimit - results.length).limit(2 * pageLimit);
      qResults = await q.toArray();
      results = results.concat(qResults);
    }
    if (results.length >= pageLimit) {
      qResultsLeftCount = results.length - pageLimit;
      results = results.slice(0, pageLimit);
      nextCursor = calcCursor(
        query.query,
        qResultsLeftCount,
        i,
        queries.length - 1,
        pageStart,
        pageLimit,
      );
      break;
    } else {
      pageStart = 0;
    }
  }

  logger.log('search results returned: ', query, results, nextCursor);
  perfEnd('fulltext:search');
  return { results, nextCursor };
}

function calcCursor(
  query: Query,
  qResultsLeftCount: number,
  currentQueryIndex: number,
  maxQueryIndex: number,
  pageStart: number,
  pageLimit: number,
): IFullTextSearchCursor | null {
  if (qResultsLeftCount > 0) {
    // there are more in current query
    return {
      next: calcCursorNext(query, currentQueryIndex, pageStart + 1, pageLimit),
      hasMorePage: true,
    };
  } else {
    if (currentQueryIndex >= maxQueryIndex) {
      // we are at the last page and last query
      return NullCursor;
    } else if (currentQueryIndex < maxQueryIndex) {
      return {
        next: calcCursorNext(query, currentQueryIndex + 1, 0, pageLimit),
        hasMorePage: true,
      };
    }
  }
}

function calcCursorNext(
  query: Query,
  nextQueryIndex: number,
  pageStart: number,
  pageLimit: number,
): string {
  return btoa(
    JSON.stringify({
      queryJSON: query.toJSON(),
      nextQueryIndex,
      pageStart,
      pageLimit,
    }),
  );
}

function decodeCursorNext(cursorNext: string): DecodedCursorNext {
  const result = JSON.parse(atob(cursorNext));
  return {
    query: new Query(result.queryJSON),
    nextQueryIndex: result.nextQueryIndex,
    pageStart: result.pageStart,
    pageLimit: result.pageLimit,
  };
}

export function calcCursorBegin(
  query: Query,
  pageLimit: number,
): IFullTextSearchCursor {
  return { next: calcCursorNext(query, 0, 0, pageLimit), hasMorePage: true };
}
