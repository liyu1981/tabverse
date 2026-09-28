import { BOOKMARK_DB_TABLE_NAME } from '../bookmark/Bookmark';
import { CLOSED_TAB_DB_TABLE_NAME } from '../closedTab/ClosedTab';
import { EntityName } from '../repo/types';
import { NOTE_DB_TABLE_NAME } from '../note/Note';
import { TABSPACE_DB_TABLE_NAME } from '../tabSpace/TabSpace';
import { TAB_DB_TABLE_NAME } from '../tabSpace/Tab';
import { TODO_DB_TABLE_NAME } from '../todo/Todo';
import { FIELD_ALL, QueryScope, TYPE_ALL } from './Query';

/**
 * What a search can look at.
 *
 * The type names are deliberately the sync entity names, so a scope maps onto
 * a server `entity=` filter without a translation table, and onto a Dexie
 * table with a single lookup. The field names match the columns/JSON fields
 * the server's `ftsBody` indexes, which is what makes "tab title" and "tab
 * url" mean the same thing on both backends.
 */
export enum SearchableType {
  TabSpace = 'tabspace',
  Tab = 'tab',
  Note = 'note',
  Todo = 'todo',
  Bookmark = 'bookmark',
  ClosedTab = 'closedtab',
}

export enum SearchableField {
  Name = 'name',
  Title = 'title',
  Url = 'url',
  Content = 'content',
  Data = 'data',
}

export interface SearchableTypeSpec {
  entity: EntityName;
  table: string;
  /** The searchable fields, in the order they are concatenated. */
  fields: string[];
  /** A tabverse is its own owner; everything else hangs off one. */
  tabSpaceIdOf: (row: any) => string;
}

export const SEARCHABLE_TYPES: SearchableTypeSpec[] = [
  {
    entity: SearchableType.TabSpace as EntityName,
    table: TABSPACE_DB_TABLE_NAME,
    fields: [SearchableField.Name],
    tabSpaceIdOf: (row) => row.id,
  },
  {
    entity: SearchableType.Tab as EntityName,
    table: TAB_DB_TABLE_NAME,
    fields: [SearchableField.Title, SearchableField.Url],
    tabSpaceIdOf: (row) => row.tabSpaceId,
  },
  {
    entity: SearchableType.Note as EntityName,
    table: NOTE_DB_TABLE_NAME,
    fields: [SearchableField.Name, SearchableField.Data],
    tabSpaceIdOf: (row) => row.tabSpaceId,
  },
  {
    entity: SearchableType.Todo as EntityName,
    table: TODO_DB_TABLE_NAME,
    fields: [SearchableField.Content],
    tabSpaceIdOf: (row) => row.tabSpaceId,
  },
  {
    entity: SearchableType.Bookmark as EntityName,
    table: BOOKMARK_DB_TABLE_NAME,
    fields: [SearchableField.Name, SearchableField.Url],
    tabSpaceIdOf: (row) => row.tabSpaceId,
  },
  {
    entity: SearchableType.ClosedTab as EntityName,
    table: CLOSED_TAB_DB_TABLE_NAME,
    fields: [SearchableField.Title, SearchableField.Url],
    tabSpaceIdOf: (row) => row.tabSpaceId,
  },
];

const BY_TYPE: { [type: string]: SearchableTypeSpec } = SEARCHABLE_TYPES.reduce(
  (acc, spec) => {
    acc[spec.entity] = spec;
    return acc;
  },
  {} as { [type: string]: SearchableTypeSpec },
);

/** The types a scope covers: one, or all of them for an unscoped group. */
export function typesForScope(scope: QueryScope): SearchableTypeSpec[] {
  if (!scope?.type || scope.type === TYPE_ALL) {
    return SEARCHABLE_TYPES;
  }
  const spec = BY_TYPE[scope.type];
  return spec ? [spec] : [];
}

/** The fields a scope covers within its type. */
export function fieldsForScope(
  spec: SearchableTypeSpec,
  scope: QueryScope,
): string[] {
  if (!scope?.field || scope.field === FIELD_ALL) {
    return spec.fields;
  }
  return spec.fields.filter((field) => field === scope.field);
}

/**
 * Case insensitive "all terms appear in this value".
 *
 * This is deliberately a substring test and not a word match: the offline
 * search has no index to consult (ADR 0008), and a substring match is the
 * behaviour a user expects from a filter box. The server backend tokenizes
 * instead, so a search can rank slightly differently depending on whether a
 * server is paired - documented, not hidden.
 */
export function valueMatchesTerms(
  value: string | undefined,
  terms: string[],
): boolean {
  if (!value || terms.length <= 0) {
    return false;
  }
  const haystack = value.toLowerCase();
  return terms.every((term) => term.length > 0 && haystack.includes(term));
}
