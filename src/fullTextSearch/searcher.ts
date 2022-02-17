import { AndQuery, FIELD_ALL, TYPE_ALL } from '.';
import { Collection, IndexableType } from 'dexie';
import {
  FullTextSearchDatabase,
  INDEX_TABLE_NAME,
} from './FullTextSearchDatabase';
import { hasOwnProperty, perfEnd, perfStart } from '../global';

import { IFullTextSearchIndexRecord } from './FullTextSearchDatabase';
import { Query } from './query';

export interface IFullTextSearchOption {
  pageStart?: number;
  pageLimit?: number;
}

export interface IFullTextSearchQuery {
  query: Query;
  option?: IFullTextSearchOption;
}

export interface IFullTextSearchCursor {
  next: string;
  restPages: number;
}

export interface IFullTextSearchResult {
  results: IFullTextSearchIndexRecord[];
  cursor: IFullTextSearchCursor | null;
}

export const PAGE_LIMIT_DEFAULT = 2;

function createQueryForAndQuery(
  db: FullTextSearchDatabase,
  andQuery: AndQuery,
): Collection<IFullTextSearchIndexRecord, IndexableType> | null {
  if (andQuery.terms.length <= 0) {
    return null;
  }

  let q = db
    .table<IFullTextSearchIndexRecord>(INDEX_TABLE_NAME)
    .where('terms')
    .equals(andQuery.terms[0]);

  for (let i = 1; i < andQuery.terms.length; i++) {
    const term = andQuery.terms[i];
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
  if (query.query.isEmpty()) {
    return {
      results: [],
      cursor: { next: '', restPages: 0 },
    };
  }

  perfStart();
  const queries = query.query.andQueries.map((andQuery) =>
    createQueryForAndQuery(db, andQuery),
  );

  let results = [];
  let cursor = null;
  let pageStart = query.option?.pageStart ?? 0;
  const pageLimit = query.option?.pageLimit ?? PAGE_LIMIT_DEFAULT;
  let qResults = [];
  let qResultsLeftCount = 0;

  for (let i = 0; i < queries.length; i++) {
    let q = queries[0];
    if (q !== null) {
      q = q.offset(pageStart * pageLimit - results.length).limit(pageLimit);
      qResults = await q.toArray();
      results = results.concat(qResults);
    }
    if (results.length >= pageLimit) {
      qResultsLeftCount = results.length - pageLimit;
      results = results.slice(0, pageLimit);
      cursor = calcCursor(
        query.query,
        results,
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

  console.log('search results returned: ', results, cursor);
  perfEnd('search');
  return { results, cursor };
}

function calcCursor(
  query: Query,
  results: IFullTextSearchIndexRecord[],
  qResultsLeftCount: number,
  currentQueryIndex: number,
  maxQueryIndex: number,
  pageStart: number,
  pageLimit: number,
): IFullTextSearchCursor | null {
  let cursor = null;
  if (results.length === pageLimit) {
    if (currentQueryIndex >= maxQueryIndex) {
      // we are at the last page and last query
      return null;
    } else if (currentQueryIndex < maxQueryIndex) {
      return {
        next: calcCursorNext(query, currentQueryIndex + 1, 0, pageLimit),
        restPages: 1,
      };
    }
  } else {
    // we still left some results in this query or still have more queries
    if (qResultsLeftCount > 0) {
      cursor = {
        next: calcCursorNext(
          query,
          currentQueryIndex,
          pageStart + 1,
          pageLimit,
        ),
        restPages: 1,
      };
    } else {
      cursor = {
        next: calcCursorNext(query, currentQueryIndex + 1, 0, pageLimit),
        restPages: 1,
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
  return btoa(JSON.stringify({ query, nextQueryIndex, pageStart, pageLimit }));
}
