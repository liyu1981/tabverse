import { Query } from './Query';
import { db } from '../../storage/db';
import { logger } from '../../global';
import { fieldsForScope, typesForScope, valueMatchesTerms } from './searchable';

/**
 * How many tabverses one search collects before it stops looking.
 *
 * The offline search is a table scan (ADR 0008), so the cap is what keeps a
 * query like "a" from walking every note body in the profile forever. It is
 * generous: a user with 999 tabverses never sees it, and one with more sees
 * the best matches rather than a frozen UI.
 */
export const LOCAL_SEARCH_LIMIT = 1000;

function addId(ids: string[], id: string, limit: number): boolean {
  if (!id || ids.includes(id)) {
    return true;
  }
  if (ids.length >= limit) {
    return false;
  }
  ids.push(id);
  return true;
}

/** One AND-group: the tabverses where a single row holds every term. */
async function tabSpaceIdsOfAndQuery(
  andQuery: { scope: any; terms: string[] },
  limit: number,
): Promise<string[]> {
  const ids: string[] = [];
  for (const spec of typesForScope(andQuery.scope)) {
    const fields = fieldsForScope(spec, andQuery.scope);
    if (fields.length <= 0) {
      continue;
    }
    const rows: any[] = await db.table(spec.table).toArray();
    for (const row of rows) {
      if (!row) {
        continue;
      }
      const hit = fields.some((field) =>
        valueMatchesTerms(row[field], andQuery.terms),
      );
      if (hit && !addId(ids, spec.tabSpaceIdOf(row), limit)) {
        logger.log(
          'local search hit the result limit, some tabverses are not in the results',
          limit,
        );
        return ids;
      }
    }
  }
  return ids;
}

/**
 * Offline search: scans the local tables and returns the matching tabverse
 * ids. A group (an "and query") needs all of its terms on one row; the groups
 * are alternatives, so their results are unioned. That is the same shape the
 * old index had: [a b] or [c d].
 */
export async function searchLocalTabSpaceIds(
  query: Query,
  limit: number = LOCAL_SEARCH_LIMIT,
): Promise<string[]> {
  if (query.isEmpty()) {
    return [];
  }
  let result: string[] | null = null;
  for (const andQuery of query.andQueries) {
    const ids = await tabSpaceIdsOfAndQuery(andQuery, limit);
    if (result === null) {
      result = ids;
    } else {
      // OR across groups: the query is a set of alternatives, each of which
      // has to hold all of its own terms on one row
      for (const id of ids) {
        if (!result.includes(id)) {
          result.push(id);
        }
      }
    }
  }
  return result ?? [];
}
