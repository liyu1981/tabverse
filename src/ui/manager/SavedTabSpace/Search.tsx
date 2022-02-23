import * as React from 'react';

import { FIELD_ALL, Query, TYPE_ALL } from '../../../fullTextSearch';
import {
  SearchableField,
  SearchableType,
} from '../../../background/fullTextSearch/addToIndex';

import { SearchInput as FullTextSearchInput } from '../../../fullTextSearch/SearchInput';
import { useMemo } from 'react';

export interface SearchInputProps {
  query: Query;
  onChange: (query: Query) => void;
}

const scopeMap = {
  anywhere: { type: TYPE_ALL, field: FIELD_ALL },
  'any tabverse data': { type: SearchableType.TabSpace },
  'any tabverse name': {
    type: SearchableType.TabSpace,
    field: SearchableField.Name,
  },
  'any tab data': { type: SearchableType.Tab },
  'any tab title': { type: SearchableType.Tab, field: SearchableField.Title },
  'any tab url': { type: SearchableType.Tab, field: SearchableField.Url },
};

export function SearchInput({ query, onChange }: SearchInputProps) {
  const onChangeQuery = useMemo(
    () => (newQuery: Query) => onChange(newQuery),
    [],
  );

  return (
    <FullTextSearchInput
      large={true}
      leftIcon={'search'}
      tagProps={{ minimal: true }}
      placeholder={'input keywords, press enter to search...'}
      query={query}
      onChangeQuery={onChangeQuery}
      scopeDefault={scopeMap['anywhere']}
      scopeMap={scopeMap}
    />
  );
}
