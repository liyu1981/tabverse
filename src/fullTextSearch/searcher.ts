import { Collection, IndexableType } from 'dexie';
import { IFullTextSearchIndexRecord } from './FullTextSearchDatabase';
import {
  FullTextSearchDatabase,
  INDEX_TABLE_NAME,
} from './FullTextSearchDatabase';

export interface IFullTextSearchOption {
  pageStart?: number;
  pageLimit?: number;
}

export interface IFullTextSearchAnd {
  terms: string[];
}

export interface IFullTextSearchOr {
  andTerms: IFullTextSearchAnd[];
}

export interface IFullTextSearchQuery {
  queryTerms: IFullTextSearchOr;
  option?: IFullTextSearchOption;
}

export const PAGE_LIMIT_DEFAULT = 2;

function createQueryForAndTerms(
  db: FullTextSearchDatabase,
  andTerms: IFullTextSearchAnd,
): Collection<IFullTextSearchIndexRecord, IndexableType> | null {
  if (andTerms.terms.length <= 0) {
    return null;
  }

  let q = db
    .table<IFullTextSearchIndexRecord>(INDEX_TABLE_NAME)
    .where('terms')
    .equals(andTerms.terms[0]);
  for (let i = 1; i < andTerms.terms.length; i++) {
    const term = andTerms.terms[i];
    q = q.and((x) => x.terms.findIndex((v) => v === term) >= 0);
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
): Promise<IFullTextSearchIndexRecord[]> {
  if (query.queryTerms.andTerms.length <= 0) {
    return [];
  }

  const queries = query.queryTerms.andTerms.map((andTerm) =>
    createQueryForAndTerms(db, andTerm),
  );

  let results = [];
  const pageStart = query.option?.pageStart ?? 0;
  const pageLimit = query.option?.pageLimit ?? PAGE_LIMIT_DEFAULT;

  for (let i = 0; i < queries.length; i++) {
    let q = queries[0];
    if (q !== null) {
      q = q.offset(pageStart - results.length).limit(pageLimit);
      const qResults = await q.toArray();
      results = results.concat(qResults);
    }
    if (results.length >= pageLimit) {
      results = results.slice(0, pageLimit);
      break;
    }
  }

  return results;
}
