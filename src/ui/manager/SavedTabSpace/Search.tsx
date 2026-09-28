import { FIELD_ALL, Query, TYPE_ALL } from '../../../data/search/Query';
import { SearchableField, SearchableType } from '../../../data/search';
import React, { useMemo } from 'react';

import { SearchInput as FullTextSearchInput } from '../../common/SearchInput';

export interface SearchInputProps {
  query: Query;
  onChange: (query: Query) => void;
}

/**
 * The scopes offered per search term. "anywhere" (the default) leaves the
 * backend to decide: with a server that is its FTS5 index over every entity,
 * without one it is the local scan (ADR 0008).
 */
export const scopeMap = {
  anywhere: { type: TYPE_ALL, field: FIELD_ALL },
  'any tabverse data': { type: SearchableType.TabSpace },
  'any tabverse name': {
    type: SearchableType.TabSpace,
    field: SearchableField.Name,
  },
  'any tab data': { type: SearchableType.Tab },
  'any tab title': { type: SearchableType.Tab, field: SearchableField.Title },
  'any tab url': { type: SearchableType.Tab, field: SearchableField.Url },
  'any note data': { type: SearchableType.Note },
  'any note name': { type: SearchableType.Note, field: SearchableField.Name },
  'any todo': { type: SearchableType.Todo },
  'any bookmark data': { type: SearchableType.Bookmark },
  'any bookmark name': {
    type: SearchableType.Bookmark,
    field: SearchableField.Name,
  },
  'any bookmark url': {
    type: SearchableType.Bookmark,
    field: SearchableField.Url,
  },
  'any closed tab': { type: SearchableType.ClosedTab },
  'any closed tab title': {
    type: SearchableType.ClosedTab,
    field: SearchableField.Title,
  },
  'any closed tab url': {
    type: SearchableType.ClosedTab,
    field: SearchableField.Url,
  },
};

export function SearchInput({ query, onChange }: SearchInputProps) {
  const onChangeQuery = useMemo(
    () => (newQuery: Query) => onChange(newQuery),
    [onChange],
  );

  return (
    <FullTextSearchInput
      large={true}
      leftIcon={'search'}
      tagProps={{ minimal: true }}
      placeholder={'input keywords,  then ↵ enter to search...'}
      query={query}
      onChangeQuery={onChangeQuery}
      scopeDefault={scopeMap['anywhere']}
      scopeMap={scopeMap}
    />
  );
}
