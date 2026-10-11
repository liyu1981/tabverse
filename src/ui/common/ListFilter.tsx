/**
 * A filter box for a list that is already in memory.
 *
 * Presentational and dumb: it owns the text, the count pill and the clear
 * button, and nothing else. Which rows match is the caller's job
 * (`data/search/inMemorySearch`), and drawing them is the list's - the same
 * split `ActiveTabSearch` uses.
 */
import { Button, InputGroup } from '@blueprintjs/core';
import React from 'react';
import clsx from 'clsx';

import classes from './ListFilter.module.scss';

export interface ListFilterProps {
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  /** How many rows match the current text. */
  count: number;
  /** How many rows the list holds before filtering. */
  total: number;
  ariaLabel: string;
}

export function ListFilter(props: ListFilterProps) {
  const filtering = props.value.trim().length > 0;
  const countText = filtering
    ? `${props.count} of ${props.total}`
    : `${props.total}`;

  return (
    <div className={classes.container}>
      <InputGroup
        className={classes.input}
        leftIcon="search"
        placeholder={props.placeholder ?? 'filter…'}
        value={props.value}
        onValueChange={props.onChange}
        rightElement={
          <div className={classes.right}>
            <span className={classes.count}>{countText}</span>
            {/* always rendered, so the count does not shift when the box
                starts filtering - hidden, so there is nothing to press */}
            <Button
              className={clsx(
                'tv-icon-button',
                !filtering ? classes.clearHidden : '',
              )}
              icon="cross"
              minimal={true}
              small={true}
              title="Clear the filter"
              aria-label="Clear the filter"
              onClick={() => props.onChange('')}
            />
          </div>
        }
        aria-label={props.ariaLabel}
        fill={true}
      />
    </div>
  );
}
