import React from 'react';

export interface TabverseSummaryProps {
  /** How many tabs the tabverse holds, which is `tabIds.length` and not the
   *  number of rows a listing counted. */
  tabCount: number;
  /** How many tab groups it remembers; zero reads as no clause at all. */
  groupCount: number;
}

/**
 * "Working on 7 tabs in 2 groups" - the line above a tabverse's tab cards.
 *
 * It started as its own component because two pages drew it: this one, and the
 * console's tabverse drawer. The console stopped using it (its list says
 * `Tabs (7)` instead, which is the same two facts in a label rather than a
 * sentence - `adr/0019`), so what is left here is the saved view's line. The
 * component stays because the wording is worth having in one place for the two
 * saved-tabverse views in this repository to share if they ever need it again,
 * and its assertions are the record of how that sentence is meant to read.
 */
export function TabverseSummary(props: TabverseSummaryProps) {
  const { tabCount, groupCount } = props;
  return (
    <p>
      Working on <b>{tabCount}</b> {tabCount === 1 ? 'tab' : 'tabs'}
      {groupCount > 0
        ? ` in ${groupCount} ${groupCount === 1 ? 'group' : 'groups'}`
        : ''}
    </p>
  );
}
