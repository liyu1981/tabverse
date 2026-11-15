/**
 * Auto grouping's Chrome half, against a fake API.
 *
 * What is pinned: create versus extend (and the "the group is gone, create a
 * new one" fallback), that a refused group does not take the others with it,
 * that a group left with fewer than two live tabs is never applied, and that a
 * title/colour miss is cosmetic rather than a failed group.
 */
import { expect, test } from 'vitest';

import type { Tab } from '../Tab';
import type { TabGroupColor } from '../TabSpace';
import type { AutoGroupChoice } from '../autoGroup';
import {
  type AutoGroupChromeApi,
  type AutoGroupLiveTab,
  applyAutoGroupChoices,
} from '../autoGroupChrome';

function tab(id: string, chromeTabId: number, url: string): Tab {
  return {
    version: 11,
    id,
    createdAt: 1,
    updatedAt: 1,
    tabSpaceId: 'ts1',
    title: id,
    url,
    favIconUrl: '',
    pinned: false,
    suspended: false,
    chromeTabId,
    chromeWindowId: 10,
    splitViewId: undefined,
    splitWith: undefined,
  };
}

function choice(
  overrides: Partial<AutoGroupChoice> & Pick<AutoGroupChoice, 'tabIds'>,
): AutoGroupChoice {
  return {
    kind: 'create',
    title: 'Group',
    color: 'blue' as TabGroupColor,
    ...overrides,
  };
}

function fakeApi(options: {
  live?: AutoGroupLiveTab[];
  groups?: Record<string, number>;
  failNew?: (chromeTabIds: number[]) => boolean;
  failUpdate?: boolean;
  failQuery?: boolean;
}) {
  const calls = {
    created: [] as { ids: number[]; windowId: number }[],
    extended: [] as { groupId: number; ids: number[] }[],
    updates: [] as {
      groupId: number;
      patch: { title?: string; color?: TabGroupColor };
    }[],
  };
  let nextGroupId = 900;
  const api: AutoGroupChromeApi = {
    queryTabs: async () => {
      if (options.failQuery) {
        throw new Error('no window');
      }
      return options.live ?? [];
    },
    groupNew: async (ids, windowId) => {
      if (options.failNew?.(ids)) {
        throw new Error('chrome said no');
      }
      calls.created.push({ ids, windowId });
      nextGroupId += 1;
      return nextGroupId;
    },
    groupInto: async (groupId, ids) => {
      calls.extended.push({ groupId, ids });
      return groupId;
    },
    updateGroup: async (groupId, patch) => {
      if (options.failUpdate) {
        throw new Error('title refused');
      }
      calls.updates.push({ groupId, patch });
    },
    chromeGroupIdOf: (ourId) => options.groups?.[ourId],
  };
  return { api, calls };
}

const liveTabs: AutoGroupLiveTab[] = [
  { chromeTabId: 101, url: 'https://a.com/1' },
  { chromeTabId: 102, url: 'https://a.com/2' },
];

test('a create groups the tabs and titles the new group', async () => {
  const { api, calls } = fakeApi({ live: liveTabs });
  const report = await applyAutoGroupChoices(
    [
      choice({
        tabIds: ['t1', 't2'],
        key: 'a.com',
        title: 'A',
        color: 'purple' as TabGroupColor,
      }),
    ],
    {
      windowId: 10,
      tabs: [
        tab('t1', 101, 'https://a.com/1'),
        tab('t2', 102, 'https://a.com/2'),
      ],
      api,
    },
  );

  expect(calls.created).toEqual([{ ids: [101, 102], windowId: 10 }]);
  expect(calls.updates).toEqual([
    { groupId: 901, patch: { title: 'A', color: 'purple' } },
  ]);
  expect(report).toMatchObject({
    created: 1,
    extended: 0,
    groups: 1,
    tabs: 2,
    failed: 0,
  });
});

test('an extend adds its tabs to the group the page still knows', async () => {
  const { api, calls } = fakeApi({
    live: liveTabs,
    groups: { g1: 77 },
  });
  const report = await applyAutoGroupChoices(
    [
      choice({
        kind: 'extend',
        groupId: 'g1',
        tabIds: ['t1', 't2'],
        title: 'Work',
      }),
    ],
    {
      windowId: 10,
      tabs: [
        tab('t1', 101, 'https://a.com/1'),
        tab('t2', 102, 'https://a.com/2'),
      ],
      api,
    },
  );

  expect(calls.extended).toEqual([{ groupId: 77, ids: [101, 102] }]);
  expect(calls.created).toEqual([]);
  expect(report).toMatchObject({ extended: 1, created: 0, groups: 1 });
});

test('an extend whose group is gone creates a new group instead', async () => {
  const { api, calls } = fakeApi({ live: liveTabs });
  const report = await applyAutoGroupChoices(
    [choice({ kind: 'extend', groupId: 'g1', tabIds: ['t1', 't2'] })],
    {
      windowId: 10,
      tabs: [
        tab('t1', 101, 'https://a.com/1'),
        tab('t2', 102, 'https://a.com/2'),
      ],
      api,
    },
  );

  expect(calls.created).toHaveLength(1);
  expect(report).toMatchObject({ created: 1, extended: 0, failed: 0 });
});

test('one refused group does not stop the others', async () => {
  const { api, calls } = fakeApi({
    live: [
      { chromeTabId: 101, url: 'https://a.com/1' },
      { chromeTabId: 102, url: 'https://a.com/2' },
      { chromeTabId: 201, url: 'https://b.com/1' },
      { chromeTabId: 202, url: 'https://b.com/2' },
    ],
    failNew: (ids) => ids.includes(101),
  });
  const report = await applyAutoGroupChoices(
    [
      choice({ tabIds: ['t1', 't2'] }),
      choice({ tabIds: ['t3', 't4'], title: 'B' }),
    ],
    {
      windowId: 10,
      tabs: [
        tab('t1', 101, 'https://a.com/1'),
        tab('t2', 102, 'https://a.com/2'),
        tab('t3', 201, 'https://b.com/1'),
        tab('t4', 202, 'https://b.com/2'),
      ],
      api,
    },
  );

  expect(calls.created).toHaveLength(1);
  expect(report).toMatchObject({ failed: 1, groups: 1, tabs: 2 });
});

test('a group with fewer than two live tabs is not applied', async () => {
  const { api, calls } = fakeApi({
    live: [{ chromeTabId: 101, url: 'https://a.com/1' }],
  });
  const report = await applyAutoGroupChoices(
    [choice({ tabIds: ['t1', 'gone'] })],
    { windowId: 10, tabs: [tab('t1', 101, 'https://a.com/1')], api },
  );

  expect(calls.created).toEqual([]);
  expect(report).toMatchObject({ droppedGroups: 1, groups: 0 });
});

test('a title/colour miss is not a failed group', async () => {
  const { api } = fakeApi({ live: liveTabs, failUpdate: true });
  const report = await applyAutoGroupChoices(
    [choice({ tabIds: ['t1', 't2'] })],
    {
      windowId: 10,
      tabs: [
        tab('t1', 101, 'https://a.com/1'),
        tab('t2', 102, 'https://a.com/2'),
      ],
      api,
    },
  );
  expect(report).toMatchObject({ groups: 1, failed: 0 });
});

test('a window that cannot be read fails every choice, and nothing is grouped', async () => {
  const { api, calls } = fakeApi({ failQuery: true });
  const report = await applyAutoGroupChoices(
    [choice({ tabIds: ['t1', 't2'] }), choice({ tabIds: ['t3', 't4'] })],
    {
      windowId: 10,
      tabs: [
        tab('t1', 101, 'https://a.com/1'),
        tab('t2', 102, 'https://a.com/2'),
      ],
      api,
    },
  );
  expect(calls.created).toEqual([]);
  expect(report).toMatchObject({ failed: 2, groups: 0 });
});

test('no choices is no work', async () => {
  const { api, calls } = fakeApi({ live: liveTabs });
  const report = await applyAutoGroupChoices([], {
    windowId: 10,
    tabs: [],
    api,
  });
  expect(calls.created).toEqual([]);
  expect(report).toMatchObject({ groups: 0, failed: 0 });
});
