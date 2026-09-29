/**
 * Group hints are the one piece of the tab feature set with real logic behind
 * it: chrome's group ids are session scoped, so what we store is our own id
 * plus title/colour/membership, and restore has to work from that alone.
 */
import {
  TAB_GROUP_COLORS_JS,
  captureTabGroups,
  groupOfTab,
  isTabGroupColor,
  resetTabGroupMappingForTest,
  restoreTabGroups,
} from '../tabGroup';
import { TabGroupHint } from '../TabSpace';

const originalChrome = (globalThis as any).chrome;

function installChrome(overrides: any = {}) {
  (globalThis as any).chrome = {
    tabs: {},
    tabGroups: { query: async () => [] },
    ...overrides,
  };
  return (globalThis as any).chrome;
}

beforeEach(() => {
  resetTabGroupMappingForTest();
});

afterAll(() => {
  (globalThis as any).chrome = originalChrome;
});

test('colour guard accepts chrome nine and nothing else', () => {
  for (const color of [
    'grey',
    'blue',
    'red',
    'yellow',
    'green',
    'pink',
    'purple',
    'cyan',
    'orange',
  ]) {
    expect(isTabGroupColor(color)).toBe(true);
    expect(
      TAB_GROUP_COLORS_JS[color as keyof typeof TAB_GROUP_COLORS_JS],
    ).toMatch(/^#/);
  }
  expect(isTabGroupColor('chartreuse')).toBe(false);
  expect(isTabGroupColor(undefined)).toBe(false);
});

test('capture is skipped entirely in a browser without tabGroups', async () => {
  installChrome({ tabGroups: undefined });
  const result = await captureTabGroups(1, new Map([[10, 'our-1']]));
  expect(result).toBeNull();
});

test('capture turns chrome groups into hints with our own ids', async () => {
  installChrome({
    tabGroups: {
      query: async () => [
        { id: 5, title: 'work', color: 'blue', windowId: 1, collapsed: false },
        { id: 6, title: 'only the manager tab', color: 'red', windowId: 1 },
      ],
    },
    tabs: {
      get: async (id: number) => ({ id, groupId: id === 10 ? 5 : -1 }),
    },
  });

  const hints = await captureTabGroups(
    1,
    new Map([
      [10, 'our-1'],
      [11, 'our-2'],
    ]),
  );

  expect(hints).toHaveLength(1); // the group with none of our tabs is dropped
  expect(hints?.[0]).toMatchObject({ title: 'work', color: 'blue' });
  expect(hints?.[0].tabIds).toEqual(['our-1']);
  expect(hints?.[0].id).toBeTruthy();
  // a second scan of the same chrome group keeps the same id
  const again = await captureTabGroups(
    1,
    new Map([
      [10, 'our-1'],
      [11, 'our-2'],
    ]),
  );
  expect(again?.[0].id).toBe(hints?.[0].id);
});

test('groupOfTab finds the group, or nothing', () => {
  const groups: TabGroupHint[] = [
    { id: 'g1', title: 'work', color: 'blue', tabIds: ['t1', 't2'] },
  ];
  expect(groupOfTab(groups, 't2')?.title).toBe('work');
  expect(groupOfTab(groups, 't9')).toBeUndefined();
  expect(groupOfTab(undefined, 't1')).toBeUndefined();
});

describe('restoreTabGroups', () => {
  const group: TabGroupHint = {
    id: 'g1',
    title: 'work',
    color: 'blue',
    tabIds: ['t1', 't2'],
  };

  test('is a no-op without the capability', async () => {
    installChrome({ tabGroups: undefined });
    const restored = await restoreTabGroups(
      [group],
      new Map([
        ['t1', 1],
        ['t2', 2],
      ]),
      () => false,
    );
    expect(restored).toBe(0);
  });

  test('skips a group whose tabs did not survive', async () => {
    installChrome();
    // only one of the two tabs came back
    const restored = await restoreTabGroups(
      [group],
      new Map([['t1', 1]]),
      () => false,
    );
    expect(restored).toBe(0);
  });

  test('skips malformed hints instead of throwing', async () => {
    installChrome();
    const restored = await restoreTabGroups(
      [null as any, { id: '', title: 'x', color: 'red', tabIds: ['t1', 't2'] }],
      new Map([
        ['t1', 1],
        ['t2', 2],
      ]),
      () => false,
    );
    expect(restored).toBe(0);
  });

  test('rebuilds the group and applies title and colour', async () => {
    const grouped: number[][] = [];
    const updated: any[] = [];
    installChrome({
      tabs: {
        group: async (options: any) => {
          grouped.push(options.tabIds);
          return 77;
        },
      },
      tabGroups: {
        query: async () => [],
        update: async (id: number, props: any) => {
          updated.push({ id, props });
          return { id, ...props };
        },
      },
    });

    const restored = await restoreTabGroups(
      [group],
      new Map([
        ['t1', 1],
        ['t2', 2],
      ]),
      () => false,
    );

    expect(restored).toBe(1);
    expect(grouped).toEqual([[1, 2]]);
    expect(updated).toEqual([
      { id: 77, props: { title: 'work', color: 'blue' } },
    ]);
  });

  test('refuses to mix pinned and unpinned tabs in one group', async () => {
    let groupCalled = false;
    installChrome({
      tabs: {
        group: async () => {
          groupCalled = true;
          return 1;
        },
      },
      tabGroups: { query: async () => [], update: async () => undefined },
    });

    const pinnedById = new Map([
      [1, true],
      [2, false],
    ]);
    const restored = await restoreTabGroups(
      [group],
      new Map([
        ['t1', 1],
        ['t2', 2],
      ]),
      (tabId) => !!pinnedById.get(tabId),
    );

    expect(restored).toBe(0);
    expect(groupCalled).toBe(false);
  });

  test('one failed group does not stop the next one', async () => {
    const updated: any[] = [];
    installChrome({
      tabs: {
        group: async (options: any) => {
          if (options.tabIds[0] === 1) {
            throw new Error('chrome said no');
          }
          return 5;
        },
      },
      tabGroups: {
        query: async () => [],
        update: async (id: number, props: any) => {
          updated.push({ id, props });
          return { id, ...props };
        },
      },
    });

    const restored = await restoreTabGroups(
      [
        { id: 'g1', title: 'first', color: 'red', tabIds: ['t1', 't2'] },
        { id: 'g2', title: 'second', color: 'green', tabIds: ['t3', 't4'] },
      ],
      new Map([
        ['t1', 1],
        ['t2', 2],
        ['t3', 3],
        ['t4', 4],
      ]),
      () => false,
    );

    expect(restored).toBe(1);
    expect(updated).toEqual([
      { id: 5, props: { title: 'second', color: 'green' } },
    ]);
  });
});
