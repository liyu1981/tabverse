import { expect, test } from 'vitest';

import {
  groupColorVar,
  storedCount,
  tabverseEntries,
  tabverseSummary,
} from './tabverseView';
import type { BundleRow, TabspaceBundle } from './types';

function tab(
  id: string,
  position: number,
  extra: Record<string, any> = {},
): BundleRow {
  return {
    id,
    rev: 1,
    updated_at: 1000,
    server_at: 1000,
    position,
    data: {
      title: `tab ${id}`,
      url: `https://example.com/${id}`,
      favIconUrl: '',
      pinned: false,
      suspended: false,
      ...extra,
    },
  };
}

function bundle(over: Partial<TabspaceBundle> = {}): TabspaceBundle {
  return {
    tabspace: {
      id: 'ts_1',
      name: 'Window-3',
      created_at: 1,
      updated_at: 2,
      rev: 3,
      tab_count: 0,
      groups: 0,
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

test('tabs read in the stored order, not in the order they arrived', () => {
  const entries = tabverseEntries(
    bundle({ tabs: [tab('t2', 1), tab('t1', 0), tab('t3', 2)] }),
  );
  expect(
    entries.map((entry) => (entry.kind === 'tab' ? entry.tab.id : 'group')),
  ).toEqual(['t1', 't2', 't3']);
});

test('a group is one block, at its first member, and takes the rest with it', () => {
  // The tabverse interleaves groups with ungrouped tabs, so "the tab after this
  // one is in the group" is not the rule; membership by id is.
  const b = bundle({
    tabs: [tab('t1', 0), tab('t2', 1), tab('t3', 2), tab('t4', 3)],
    tabspace_data: {
      tabGroups: [
        { id: 'g1', title: 'work', color: 'blue', tabIds: ['t3', 't1'] },
      ],
    },
  });
  const entries = tabverseEntries(b);
  expect(entries.map((e) => e.kind)).toEqual(['group', 'tab', 'tab']);
  const group = entries[0];
  expect(group.kind === 'group' && group.group.id).toBe('g1');
  expect(group.kind === 'group' && group.tabs.map((t) => t.id)).toEqual([
    't1',
    't3',
  ]);
  // ...and neither member is drawn a second time.
  const drawn = entries.flatMap((entry) =>
    entry.kind === 'tab' ? [entry.tab.id] : entry.tabs.map((t) => t.id),
  );
  expect(drawn).toEqual(['t1', 't3', 't2', 't4']);
});

test('a group whose tabs are all gone keeps its header', () => {
  // It is still a group the user made; dropping it silently would be a tabverse
  // that looks emptier than it is.
  const entries = tabverseEntries(
    bundle({
      tabs: [tab('t1', 0)],
      tabspace_data: {
        tabGroups: [{ id: 'g2', title: 'gone', color: 'grey', tabIds: ['tX'] }],
      },
    }),
  );
  expect(entries.map((e) => e.kind)).toEqual(['tab', 'group']);
  expect(entries[1].kind === 'group' && entries[1].tabs).toEqual([]);
});

test('the summary line counts tabs and groups the way the extension states them', () => {
  const b = bundle({
    tabs: [tab('t1', 0), tab('t2', 1)],
    tabspace_data: {
      tabGroups: [{ id: 'g1', title: '', color: 'grey', tabIds: ['t2'] }],
    },
  });
  expect(tabverseSummary(b)).toEqual({ tabs: 2, groups: 1 });
});

test('everything that is not a tab is counted for the folded-away summary', () => {
  expect(
    storedCount(
      bundle({
        notes: [tab('n1', 0)],
        todos: [tab('d1', 0), tab('d2', 1)],
        bookmarks: [tab('b1', 0)],
        closed_tabs: [tab('c1', 0)],
      }),
    ),
  ).toBe(5);
});

test("a group's colour is a css custom property, grey when it is not one of the nine", () => {
  expect(groupColorVar('blue')).toBe('var(--group-blue)');
  expect(groupColorVar('chartreuse')).toBe('var(--group-grey)');
  expect(groupColorVar('')).toBe('var(--group-grey)');
});

test('a payload missing its fields is a card with blanks, not an exception', () => {
  const entries = tabverseEntries(
    bundle({
      tabs: [
        {
          id: 't9',
          rev: 1,
          updated_at: 1,
          server_at: 1,
          position: 0,
          data: {},
        },
      ],
    }),
  );
  expect(entries[0].kind === 'tab' && entries[0].tab).toMatchObject({
    title: '',
    url: '',
    pinned: false,
  });
});
