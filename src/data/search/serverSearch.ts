import { FIELD_ALL, Query, TYPE_ALL } from './Query';
import {
  SearchableType,
  SearchableTypeSpec,
  typesForScope,
  valueMatchesTerms,
} from './searchable';
import { ServerApiClient } from '../repo/serverApi';
import { db } from '../../storage/db';

/** The server caps a search at 200 hits; asking for more is a no-op. */
export const SERVER_SEARCH_LIMIT = 200;

/**
 * A hit names the tabverse it belongs to (the server resolves it, see
 * api/openapi.yaml), so a match on one tab, note or closed tab means "this
 * tabverse matched". Older servers that predate `tabspace_id` still work for
 * tabspace hits, where the record id *is* the tabverse id.
 */
function tabSpaceIdOfHit(entity: string | undefined, hit: any): string {
  if (hit.tabspace_id) {
    return hit.tabspace_id;
  }
  return entity === SearchableType.TabSpace ? hit.id : '';
}

/**
 * Field scopes ("tab url", "tabverse name") have no counterpart in the
 * server's index - it concatenates a record's strings and does not remember
 * which field a term came from. So a field scoped group is verified here,
 * against the local row, and a row this device does not have is dropped: the
 * result is filtered to local tabverses anyway, and "we could not check it"
 * is not the same as "it matched".
 */
async function keepHitsInField(
  spec: SearchableTypeSpec,
  field: string,
  terms: string[],
  hits: any[],
): Promise<any[]> {
  if (field === FIELD_ALL || field.length <= 0) {
    return hits;
  }
  const rows = await db.table(spec.table).bulkGet(hits.map((hit) => hit.id));
  const byId = new Map<string, any>();
  rows.forEach((row) => {
    if (row) {
      byId.set(row.id, row);
    }
  });
  return hits.filter((hit) =>
    valueMatchesTerms(byId.get(hit.id)?.[field], terms),
  );
}

async function tabSpaceIdsOfAndQuery(
  api: ServerApiClient,
  andQuery: { scope: any; terms: string[] },
  limit: number,
): Promise<string[]> {
  const text = andQuery.terms.join(' ');
  if (text.trim().length <= 0) {
    return [];
  }
  const specs = typesForScope(andQuery.scope);
  const scoped = andQuery.scope?.type && andQuery.scope.type !== TYPE_ALL;
  const entity = scoped ? specs[0].entity : undefined;
  const { hits } = await api.search(text, { entity, limit });

  // an unscoped group searches every indexed entity at once, and a field
  // filter is not meaningful across types, so it only applies when the group
  // names both a type and a field
  let usable = hits;
  if (scoped && specs.length === 1) {
    usable = await keepHitsInField(
      specs[0],
      andQuery.scope.field,
      andQuery.terms,
      hits,
    );
  }

  const ids: string[] = [];
  for (const hit of usable) {
    const tabSpaceId = tabSpaceIdOfHit(hit.entity, hit);
    if (tabSpaceId && !ids.includes(tabSpaceId)) {
      ids.push(tabSpaceId);
    }
  }
  return ids;
}

/**
 * Server side search (ADR 0008). Each group is one server round trip (the
 * server ANDs the terms), the groups are alternatives, and the result is
 * tabverse ids in the server's relevance order.
 */
export async function searchServerTabSpaceIds(
  api: ServerApiClient,
  query: Query,
  limit: number = SERVER_SEARCH_LIMIT,
): Promise<string[]> {
  if (query.isEmpty()) {
    return [];
  }
  let result: string[] | null = null;
  for (const andQuery of query.andQueries) {
    const ids = await tabSpaceIdsOfAndQuery(api, andQuery, limit);
    if (result === null) {
      result = ids;
    } else {
      // OR across groups, see localSearch.ts
      for (const id of ids) {
        if (!result.includes(id)) {
          result.push(id);
        }
      }
    }
  }
  return result ?? [];
}
