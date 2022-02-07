import * as React from 'react';

import { useEffect, useMemo, useState } from 'react';

import { TagInput } from '@blueprintjs/core';
import { tokenize } from '../../../fullTextSearch';

function mergeTerms(terms1: string[], terms2: string[]) {
  return Array.from(new Set(terms1.concat(terms2)));
}

export interface SearchInputProps {
  onChange: (terms: string[]) => void;
}

export function SearchInput(props: SearchInputProps) {
  const [searchQueryTerms, setSearchQueryTerms] = useState<string[]>([]);

  const onAddTerm = useMemo(() => {
    return (values: string[]) => {
      const value = values[0];
      tokenize(value).then(({ terms }) =>
        setSearchQueryTerms((lastTerms) => mergeTerms(lastTerms, terms)),
      );
    };
  }, []);

  const onRemoveTerm = useMemo(() => {
    return (value: React.ReactNode, index: number) => {
      setSearchQueryTerms((lastTerms) => {
        lastTerms.splice(index, 1);
        const newTerms = [].concat(lastTerms);
        return newTerms;
      });
    };
  }, []);

  useEffect(() => {
    props.onChange(searchQueryTerms);
  }, [searchQueryTerms]);

  return (
    <TagInput
      large={true}
      leftIcon={'search'}
      tagProps={{ minimal: true }}
      placeholder={'input keyword to search...'}
      values={searchQueryTerms}
      onAdd={onAddTerm}
      onRemove={onRemoveTerm}
    />
  );
}
