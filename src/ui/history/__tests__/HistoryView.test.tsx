import { beforeEach, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { List } from 'immutable';
import React from 'react';

import { HistoryEntries, HistoryView } from '../HistoryView';
import { HistoryToolbar } from '../HistoryToolbar';
import {
  $allClosedTab,
  closedTabStoreApi,
} from '../../../data/closedTab/store';
import { newEmptyAllClosedTab } from '../../../data/closedTab/AllClosedTab';
import historyClasses from '../HistoryView.module.scss';
import type { ClosedTab } from '../../../data/closedTab/ClosedTab';

/**
 * How many closed tabs a page holds.
 *
 * A closed tab is a row of two lines plus three controls, and the Bookmark tool
 * beside this one already pages at ten. Twenty was a list that had to be
 * scrolled to be read, in a panel whose whole job is to be read - so this pins
 * the number rather than leaving it to whoever edits the constant next.
 *
 * `ManagerViewContext` has a silent fallback toaster, so the view renders with no
 * provider and no chrome APIs, and `renderToStaticMarkup` does not run effects -
 * which is why the store can simply be told what the history holds.
 */

function closed(i: number): ClosedTab {
  return {
    id: `c${i + 1}`,
    tabSpaceId: 'ts_1',
    title: `closed ${i + 1}`,
    url: `https://example.com/${i + 1}`,
    favIconUrl: '',
    closedAt: Date.parse('2026-10-02T09:00:00Z'),
    timesClosed: 1,
    createdAt: 0,
    updatedAt: 1,
    version: 0,
  };
}

/** The store told through its own api, which is the path the extension uses. */
function withHistory(count: number) {
  closedTabStoreApi.update({
    ...newEmptyAllClosedTab(),
    closedTabs: List(Array.from({ length: count }, (_, i) => closed(i))),
  });
}

// ---- the search box and the group switch -----------------------------------
//
// What these can honestly check is the wiring: the card draws the box and the
// switch, the switch says which way it is set, the count says what the box
// matched, and the grouped list is the same rows under site headers. Typing and
// clicking are not here - there is no jsdom in this repo (AGENTS.md) and
// `renderToStaticMarkup` runs no effects. The two questions the card asks
// ("which rows match", "which site is this row from") are asked directly in
// `data/closedTab/__tests__/historyFilter.test.ts`; what is left untested by
// machine is the keystroke and the click.

const noop = () => undefined;

/** A row on a named site, newest first down the list (closedAt descending). */
function onSite(i: number, host: string, title = `closed ${i + 1}`): ClosedTab {
  return {
    ...closed(i),
    title,
    url: `https://${host}/${i + 1}`,
    // the store keeps the list newest first, and the grouped view must not
    // reorder it inside a site
    closedAt: Date.now() - i * 1000,
  };
}

function entries(props: { entries: ClosedTab[]; grouped: boolean }): string {
  return renderToStaticMarkup(
    <HistoryEntries
      entries={props.entries}
      grouped={props.grouped}
      isBookmarked={noop}
      restore={noop}
      saveAsBookmark={noop}
      remove={noop}
    />,
  );
}

function toolbar(props: {
  value: string;
  matchCount: number;
  totalCount: number;
  grouped?: boolean;
}): string {
  return renderToStaticMarkup(
    <HistoryToolbar
      value={props.value}
      onChange={noop}
      matchCount={props.matchCount}
      totalCount={props.totalCount}
      grouped={props.grouped === true}
      onToggleGrouped={noop}
    />,
  );
}

test('the card carries a search box and a switch to group by site', () => {
  withHistory(25);
  const html = renderToStaticMarkup(<HistoryView />);
  expect(html).toContain('bp6-icon-search');
  expect(html).toContain('search these closed tabs');
  // the switch, saying which way it is currently set
  expect(html).toContain('bp6-icon-group-objects');
  expect(html).toContain('aria-pressed="false"');
  // and the count of what the empty box matches: everything
  expect(html).toContain('>25<');
});

test('the count says what the box matched, and the switch follows the box', () => {
  expect(toolbar({ value: 'github', matchCount: 3, totalCount: 25 })).toContain(
    '3 of 25',
  );
  // no text in the box is not a search, so it says the whole list
  expect(toolbar({ value: '', matchCount: 25, totalCount: 25 })).toContain(
    '>25<',
  );
  expect(
    toolbar({ value: 'github', matchCount: 3, totalCount: 25, grouped: true }),
  ).toContain('aria-pressed="true"');
});

test('the grouped view is the same rows under one header per site', () => {
  const rows = [
    onSite(0, 'github.com', 'a pull request'),
    onSite(1, 'news.example.com', 'the news'),
    onSite(2, 'github.com', 'an issue'),
  ];
  const html = entries({ entries: rows, grouped: true });

  expect(html).toContain(historyClasses.groupHeader);
  expect(html).toContain('github.com');
  expect(html).toContain('news.example.com');
  expect(html).toContain('a pull request');
  expect(html).toContain('the news');
  expect(html).toContain('an issue');
  // a site is a header, not a row: the three rows are the three `<li>`s
  expect((html.match(/<li>/g) ?? []).length).toBe(3);
  // two of them share one header, so the count on it is 2
  expect(html).toContain('>2<');
  // and inside that group the newest page is on top
  expect(html.indexOf('a pull request')).toBeLessThan(html.indexOf('an issue'));
});

test('the grouped view is not the paged list wearing headers', () => {
  // More rows than a page holds, drawn together under their sites: a page that
  // ended in the middle of a site would print that site's header twice.
  const rows = Array.from({ length: 25 }, (_, i) =>
    onSite(i, `site${Math.floor(i / 10)}.example.com`),
  );
  const html = entries({ entries: rows, grouped: true });
  expect((html.match(/<li>/g) ?? []).length).toBe(25);
  // three headers for the three sites (the rows print their own urls, so the
  // host text appears more often than the header does)
  expect(
    (html.match(new RegExp(historyClasses.groupHeader, 'g')) ?? []).length,
  ).toBe(3);
  expect(html).not.toContain('1/3');
  expect(html).not.toContain('bp6-icon-chevron-right');
});

test('the flat view is still the paged list, with no headers on it', () => {
  const rows = Array.from({ length: 25 }, (_, i) => onSite(i, 'a.example.com'));
  const html = entries({ entries: rows, grouped: false });
  expect((html.match(/<li>/g) ?? []).length).toBe(10);
  expect(html).toContain('1/3');
  // every row is in one list, with no site header above it (the header is what
  // has to be looked for, not the word: the rows print their own url)
  expect((html.match(/<ul[ >]/g) ?? []).length).toBe(1);
  expect(html).not.toContain(historyClasses.groupHeader);
});

beforeEach(() => {
  closedTabStoreApi.update(newEmptyAllClosedTab());
});

test('ten rows a page, and a control saying how many pages there are', () => {
  withHistory(25);
  const html = renderToStaticMarkup(<HistoryView />);
  // ten rows, not twenty-five. `<li>` with the bracket: the favicon preload is
  // a `<link>`, and counting the tag name alone finds one more.
  expect((html.match(/<li>/g) ?? []).length).toBe(10);
  expect(html).toContain('closed 1');
  expect(html).toContain('closed 10');
  expect(html).not.toContain('closed 11');
  // and it is visible that this is one page of the list, not all of it
  expect(html).toContain('1/3');
  expect(html).toContain('bp6-icon-chevron-right');
});

test('a history that fits on one page has no control to press', () => {
  withHistory(4);
  const html = renderToStaticMarkup(<HistoryView />);
  expect((html.match(/<li>/g) ?? []).length).toBe(4);
  expect(html).not.toContain('bp6-icon-chevron-left');
  expect(html).not.toContain('1/');
});

test('exactly ten is one page, not two', () => {
  // The off-by-one a page limit always has somewhere: a list that divides evenly
  // must not grow an empty second page.
  withHistory(10);
  const html = renderToStaticMarkup(<HistoryView />);
  expect((html.match(/<li>/g) ?? []).length).toBe(10);
  expect(html).not.toContain('1/');
});

test('eleven is two pages', () => {
  withHistory(11);
  const html = renderToStaticMarkup(<HistoryView />);
  expect((html.match(/<li>/g) ?? []).length).toBe(10);
  expect(html).toContain('1/2');
  expect(html).not.toContain('closed 11');
});

test('an empty history is the notice, and no rows at all', () => {
  withHistory(0);
  const html = renderToStaticMarkup(<HistoryView />);
  expect(html).not.toContain('<li>');
  expect(html).toContain('No tab closed in this tabverse yet');
  expect($allClosedTab.getState().closedTabs.size).toBe(0);
});
