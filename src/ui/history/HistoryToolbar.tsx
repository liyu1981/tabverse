import { Button, InputGroup } from '@blueprintjs/core';
import React from 'react';
import clsx from 'clsx';

import classes from './HistoryView.module.scss';

export interface HistoryToolbarProps {
  /** What is in the box. Empty means no search, and the whole list. */
  value: string;
  onChange: (text: string) => void;
  /** How many entries the box's text matches, and how many there are. */
  matchCount: number;
  totalCount: number;
  /** Whether the list is drawn in site groups. */
  grouped: boolean;
  onToggleGrouped: () => void;
  /**
   * Hands the input to a view that wants to focus it. Optional: the console's
   * drawer has no shortcut to hang one on.
   */
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

/**
 * The History card's search box and group switch.
 *
 * One component for both places the history is drawn - the extension's tool and
 * the console's read-only panel - for the reason the console already reuses
 * this card's stylesheet and `usePageControl`: a filter and a switch drawn
 * twice are two that will drift. What the box *matches* is
 * `data/closedTab/historyFilter`'s job, on both sides; this is the chrome, and it
 * reports the two answers it is given rather than computing either.
 *
 * The count lives inside the box because a search over a list you can see is a
 * question with two answers: which entries are these, and out of how many.
 */
export function HistoryToolbar(props: HistoryToolbarProps) {
  const isFiltering = props.value.trim().length > 0;
  const countText = isFiltering
    ? `${props.matchCount} of ${props.totalCount}`
    : `${props.totalCount}`;

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') {
      return;
    }
    // the first Escape empties the box, the second hands the keyboard back
    event.preventDefault();
    if (isFiltering) {
      props.onChange('');
    } else {
      event.currentTarget.blur();
    }
  };

  return (
    <div className={classes.toolbar}>
      <InputGroup
        inputRef={props.inputRef}
        leftIcon="search"
        placeholder="search these closed tabs"
        value={props.value}
        onValueChange={props.onChange}
        onKeyDown={onKeyDown}
        rightElement={
          <div className={classes.searchRight}>
            <span className={classes.searchCount}>{countText}</span>
            {/* always rendered, so the count does not shift the moment the box
                starts filtering - hidden, so there is nothing to press */}
            <Button
              className={clsx(
                'tv-icon-button',
                !isFiltering ? classes.searchClearHidden : '',
              )}
              icon="cross"
              minimal={true}
              small={true}
              title="Clear the search (Esc)"
              aria-label="Clear the history search"
              onClick={() => props.onChange('')}
            />
          </div>
        }
        aria-label="Search the closed tabs"
        fill={true}
      />
      <Button
        icon="group-objects"
        active={props.grouped}
        minimal={true}
        title={props.grouped ? 'Grouped by site' : 'Group by site'}
        aria-pressed={props.grouped}
        aria-label="Group the closed tabs by site"
        onClick={props.onToggleGrouped}
      />
    </div>
  );
}
