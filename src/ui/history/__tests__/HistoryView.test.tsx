import { beforeEach, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { List } from 'immutable';
import React from 'react';

import { HistoryView } from '../HistoryView';
import {
  $allClosedTab,
  closedTabStoreApi,
} from '../../../data/closedTab/store';
import { newEmptyAllClosedTab } from '../../../data/closedTab/AllClosedTab';
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
