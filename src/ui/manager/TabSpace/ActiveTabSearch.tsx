import { Button, InputGroup } from '@blueprintjs/core';
import React, { useEffect, useState } from 'react';

import { Tab } from '../../../data/tabSpace/Tab';
import classes from './ActiveTabSearch.module.scss';

export interface ActiveTabSearchProps {
  value: string;
  onChange: (text: string) => void;
  /** The tabs the current text matches, best first. */
  matches: Tab[];
  /** How many tabs the tabverse holds, so the box can say what it filters. */
  totalCount: number;
  /** Hands the input to the view, which focuses it on the `/` shortcut. */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Switches to a tab; the same thing a click on its row does. */
  onActivate: (tab: Tab) => void;
  /**
   * Which match Enter would open, so the list can mark it. The box keeps the
   * index - it is what the arrow keys move - and reports it rather than
   * owning the list.
   */
  onActiveMatchChange?: (tab: Tab | null) => void;
}

/**
 * The filter box over the tabs of the tabverse on screen.
 *
 * It owns only what belongs to the box: the count, the clear button, and which
 * match the arrow keys are on. Deciding which tabs match is
 * `data/tabSpace/activeTabFilter`'s job, and drawing them is the list's.
 *
 * Arrow keys plus Enter are the reason for the `/` shortcut: type, arrow to
 * the tab you meant, Enter, without touching the mouse.
 */
export function ActiveTabSearch(props: ActiveTabSearchProps) {
  const { matches, onActiveMatchChange, value } = props;
  const [activeIndex, setActiveIndex] = useState<number>(0);

  const isFiltering = value.trim().length > 0;
  const count = matches.length;

  // a list that changed under the cursor (a tab was closed, the text narrowed)
  // must not leave the highlight pointing past the end of it
  useEffect(() => {
    setActiveIndex((index) => (index < count ? index : 0));
  }, [count]);

  useEffect(() => {
    onActiveMatchChange?.(isFiltering ? (matches[activeIndex] ?? null) : null);
  }, [onActiveMatchChange, matches, activeIndex, isFiltering]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!isFiltering || count <= 0) {
        return;
      }
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => (index + step + count) % count);
      return;
    }
    if (event.key === 'Enter') {
      const tab = isFiltering ? matches[activeIndex] : undefined;
      if (tab) {
        event.preventDefault();
        props.onActivate(tab);
      }
      return;
    }
    if (event.key === 'Escape') {
      // the first Escape empties the box, the second hands the keyboard back
      event.preventDefault();
      if (isFiltering) {
        props.onChange('');
      } else {
        event.currentTarget.blur();
      }
    }
  };

  const countText = isFiltering
    ? `${count} of ${props.totalCount}`
    : `${props.totalCount} tabs`;

  return (
    <div className={classes.container}>
      <InputGroup
        inputRef={props.inputRef}
        leftIcon="search"
        placeholder={`filter these ${props.totalCount} tabs…  (press / )`}
        value={value}
        onValueChange={props.onChange}
        onKeyDown={onKeyDown}
        rightElement={
          <div className={classes.right}>
            <span className={classes.count}>{countText}</span>
            {isFiltering ? (
              <Button
                className="tv-icon-button"
                icon="cross"
                minimal={true}
                small={true}
                title="Clear the filter (Esc)"
                aria-label="Clear the tab filter"
                onClick={() => {
                  props.onChange('');
                  props.inputRef.current?.focus();
                }}
              />
            ) : null}
          </div>
        }
        aria-label="Search the tabs of this tabverse"
        fill={true}
      />
    </div>
  );
}
