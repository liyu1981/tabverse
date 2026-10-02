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
 * It is its own component because two pages draw it: the extension's
 * saved-tabverse view, and the console's tabverse drawer, which shows the same
 * view of a tabverse stored on an account this browser does not own
 * (`adr/0019`). When the wording lives in one place, "the console shows what the
 * extension shows" is a fact about the code rather than something to keep an eye
 * on.
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
