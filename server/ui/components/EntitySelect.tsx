import { HTMLSelect } from '@blueprintjs/core';
import React from 'react';

import { ENTITIES } from '../data/types';

interface EntitySelectProps {
  value: string;
  onChange: (entity: string) => void;
  /** The aggregates are id lists, and they are not in the FTS index
   *  (adr/0008), so the search filter does not offer them. */
  omitAggregates?: boolean;
  label?: string;
}

export function EntitySelect(props: EntitySelectProps) {
  const entities = props.omitAggregates
    ? ENTITIES.filter((entity) => !entity.startsWith('all'))
    : ENTITIES;
  return (
    <HTMLSelect
      value={props.value}
      onChange={(event) => props.onChange(event.currentTarget.value)}
      options={[
        { value: '', label: props.label || 'all entities' },
        ...entities,
      ]}
    />
  );
}
