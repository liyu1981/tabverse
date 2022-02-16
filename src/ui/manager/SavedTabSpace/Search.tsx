import * as React from 'react';

import {
  AndQuery,
  EmptyQuery,
  FIELD_ALL,
  Query,
  TYPE_ALL,
} from '../../../fullTextSearch';
import {
  SearchableField,
  SearchableType,
} from '../../../background/fullTextSearch/addToIndex';
import { useEffect, useMemo, useState } from 'react';

import { SearchInput as FullTextSearchInput } from '../../../fullTextSearch/SearchInput';

export interface SearchInputProps {
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

export function SearchInput(props: SearchInputProps) {
  const [searchQuery, setSearchQuery] = useState<Query>(EmptyQuery);

  const onAddTerm = useMemo(
    () => (values: string[]) =>
      setSearchQuery((lastQuery) => {
        return new Query(lastQuery).addAndQuery(values, scopeMap['anywhere']);
      }),
    [],
  );

  const onRemoveTerm = useMemo(
    () => (value: AndQuery, index: number) =>
      setSearchQuery((lastQuery) => {
        return new Query(lastQuery).removeAndQuery(index);
      }),
    [],
  );

  const onChangeQuery = useMemo(
    () => (newQuery: Query) => setSearchQuery(newQuery),
    [],
  );

  useEffect(() => {
    props.onChange(searchQuery);
  }, [searchQuery]);

  return (
    <FullTextSearchInput
      large={true}
      leftIcon={'search'}
      tagProps={{ minimal: true }}
      placeholder={'input keyword to search...'}
      query={searchQuery}
      onAdd={onAddTerm}
      onRemove={onRemoveTerm}
      onChangeQuery={onChangeQuery}
      scopeMap={scopeMap}
    />
  );
}
