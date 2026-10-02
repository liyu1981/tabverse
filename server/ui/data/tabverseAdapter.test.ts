import { expect, test } from 'vitest';

import { bundleGroups, toStoredTab, toTabSpace } from './tabverseAdapter';
import type { BundleRow, TabspaceBundle } from './types';

/**
 * The seam between what the server sent and what the extension's components
 * draw (`adr/0019`).
 *
 * Two of these fields exist to say something that is not in the bundle, and
 * both are asserted here because they are the ones that would put a button on a
 * row of somebody else's data.
 */

function row(over: Partial<BundleRow> = {}): BundleRow {
  return {
    id: 't1',
    rev: 1,
    updated_at: 1000,
    server_at: 1000,
    position: 0,
    data: {
      title: 'docs',
      url: 'https://example.com/docs',
      favIconUrl: 'https://example.com/favicon.ico',
      pinned: true,
    },
    ...over,
  };
}

function bundle(over: Partial<TabspaceBundle> = {}): TabspaceBundle {
  return {
    tabspace: {
      id: 'ts_1',
      name: 'Window-3',
      created_at: 10,
      updated_at: 20,
      rev: 3,
      tab_count: 2,
      groups: 1,
      notes: 0,
      todos: 0,
      bookmarks: 0,
      closed_tabs: 0,
    },
    tabspace_data: {},
    tabs: [],
    notes: [],
    todos: [],
    bookmarks: [],
    closed_tabs: [],
    aggregates: {},
    ...over,
  };
}

test('the tabs come out in the order the server sent them', () => {
  // The server sorted them by the tabverse's own tabIds (ADR 0015), and
  // `tabverseEntries` keeps that order - so a bundle that arrives out of order
  // must not be re-sorted by something else.
  const space = toTabSpace(
    bundle({
      tabs: [row({ id: 't2', position: 1 }), row({ id: 't1', position: 0 })],
    }),
  );
  expect(space.tabs.map((tab) => tab.id).toArray()).toEqual(['t1', 't2']);
  expect(space.id).toBe('ts_1');
  expect(space.name).toBe('Window-3');
});

test('a stored tab is not a live tab in this browser', () => {
  // `-1` is the extension's "no live tab" sentinel and it is *truthy*: the card
  // reads `chromeTabId > 0` before offering a close button, so the adapter has
  // to say 0. A truthy value here puts a button on every row that calls
  // chrome.tabs.remove(-1).
  const tab = toStoredTab(row(), 'ts_1');
  expect(tab.chromeTabId).toBe(0);
  expect(tab.chromeWindowId).toBe(0);
  expect(tab.chromeTabId > 0).toBe(false);
});

test('a stored tab carries what the card draws and nothing it cannot know', () => {
  const tab = toStoredTab(row(), 'ts_1');
  expect(tab).toMatchObject({
    id: 't1',
    tabSpaceId: 'ts_1',
    title: 'docs',
    url: 'https://example.com/docs',
    favIconUrl: 'https://example.com/favicon.ico',
    pinned: true,
    suspended: false,
    updatedAt: 1000,
  });
  // The bundle knows when the record was last written; it does not know when the
  // tab itself was created, so nothing is invented.
  expect(tab.createdAt).toBe(0);
  expect(tab.splitViewId).toBeUndefined();
});

test('the groups come from the tabverse payload, in its order', () => {
  const groups = bundleGroups(
    bundle({
      tabspace_data: {
        tabGroups: [
          { id: 'g1', title: 'work', color: 'blue', tabIds: ['t2'] },
          { id: 'g2', title: '', color: 'grey', tabIds: [] },
        ],
      },
    }),
  );
  expect(groups.map((group) => group.id)).toEqual(['g1', 'g2']);
  expect(groups[0]).toEqual({
    id: 'g1',
    title: 'work',
    color: 'blue',
    tabIds: ['t2'],
  });
});

test('a tabverse stored before groups existed, or by a newer client, is not a crash', () => {
  expect(bundleGroups(bundle())).toEqual([]);
  expect(
    bundleGroups(bundle({ tabspace_data: { tabGroups: 'nonsense' } })),
  ).toEqual([]);
  const space = toTabSpace(bundle({ tabs: [row({ data: {} })] }));
  expect(space.tabs.first()).toMatchObject({
    title: '',
    url: '',
    pinned: false,
  });
});
