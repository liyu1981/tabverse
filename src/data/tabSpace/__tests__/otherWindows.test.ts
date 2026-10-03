/**
 * The proposal under test: the other tabverses open in this browser, and their
 * names, are answerable with no server at all.
 *
 *   chrome.tabs.query({})        -> tvid + windowId of every open tabverse
 *   IndexedDB (SavedTabSpace)    -> the name and the tab count of those ids
 *
 * Both halves run for real here: the chrome mock for the query, the fake
 * IndexedDB for the rows. What is pinned is the join between them, and the one
 * case where it does not join (a tabverse with no saved row).
 */

import { db } from '../../../storage/db';
import { getMockChrome } from '../../../dev/chromeMock';
import { resetTestDb } from '../../../dev/dbImplTest';
import { loadTabSpacesByIds } from '../util';
import { restoreSavedTabSpaceUtil } from '../chromeUtil';
import {
  OpenTabSpace,
  openOrSwitchToTabSpace,
  openTabSpacesOf,
  otherWindowTabSpaces,
  planOpenTabSpace,
  queryOpenTabSpaces,
} from '../openTabverses';
import { TABSPACE_MANAGER_TAB_URL_PREFIX } from '../../../global';

const managerUrl = (tvid: string) =>
  `${TABSPACE_MANAGER_TAB_URL_PREFIX}?op=new&tvid=${tvid}`;

/** A manager page (the tabverse's own tab) plus some ordinary tabs. */
function openWindow(
  mockChrome: ReturnType<typeof getMockChrome>,
  windowId: number,
  tvid: string,
  tabCount: number,
) {
  for (let i = 0; i < tabCount; i++) {
    mockChrome.insertTabFromData(
      {
        title: `page ${i}`,
        url: `https://example.com/${tvid}/${i}`,
        favIconUrl: '',
        pinned: false,
      },
      windowId,
    );
  }
  return mockChrome.insertTabFromData(
    { title: 'Tabverse', url: managerUrl(tvid), favIconUrl: '', pinned: true },
    windowId,
  );
}

/**
 * What `saveCurrentTabSpace` writes: the id, the name tabSpaceBootstrap gave
 * it, and its tab ids. Note there is no window id in the row - that is the
 * deliberate omission in convertAndGetTabSpaceSavePayload.
 */
function savedTabSpace(id: string, name: string, tabIds: string[]) {
  return {
    id,
    name,
    tabIds,
    tabGroups: [],
    version: 10,
    createdAt: 1,
    updatedAt: Date.now(),
  };
}

function savedTab(id: string, tabSpaceId: string, title: string) {
  return {
    id,
    tabSpaceId,
    title,
    url: `https://example.com/${id}`,
    favIconUrl: '',
    pinned: false,
    createdAt: 1,
    updatedAt: 1,
    version: 10,
  };
}

beforeEach(async () => {
  await resetTestDb();
});

test('chrome.tabs.query alone gives the id and the window of every open tabverse', async () => {
  const mockChrome = getMockChrome();
  const w1 = mockChrome.addWindow();
  const w2 = mockChrome.addWindow();
  openWindow(mockChrome, w1.id, 'ts-a', 2);
  openWindow(mockChrome, w2.id, 'ts-b', 3);

  const open = await queryOpenTabSpaces();

  // no server, no network, no page-to-page message: one query
  expect(open.map((o) => [o.tabSpaceId, o.chromeWindowId])).toEqual([
    ['ts-a', w1.id],
    ['ts-b', w2.id],
  ]);
  // and it can switch: the ids it hands out are the ones chrome.tabs.update takes
  expect(open.every((o) => typeof o.chromeTabId === 'number')).toBe(true);
});

test('a manager page asks for the windows that are not its own', async () => {
  const mockChrome = getMockChrome();
  const w1 = mockChrome.addWindow();
  const w2 = mockChrome.addWindow();
  const w3 = mockChrome.addWindow();
  openWindow(mockChrome, w1.id, 'ts-a', 1);
  openWindow(mockChrome, w2.id, 'ts-b', 1);
  openWindow(mockChrome, w3.id, 'ts-c', 1);
  const open = await queryOpenTabSpaces();

  expect(
    otherWindowTabSpaces(open, { windowId: w1.id, tabSpaceId: 'ts-a' }),
  ).toEqual([
    expect.objectContaining({ tabSpaceId: 'ts-b', chromeWindowId: w2.id }),
    expect.objectContaining({ tabSpaceId: 'ts-c', chromeWindowId: w3.id }),
  ]);
  // a window with no tabverse contributes nothing
  expect(
    otherWindowTabSpaces(open, { windowId: 999, tabSpaceId: 'nope' }),
  ).toHaveLength(3);
});

test('the same tabverse open in two windows is a neighbour once, not twice', async () => {
  const mockChrome = getMockChrome();
  const w1 = mockChrome.addWindow();
  const w2 = mockChrome.addWindow();
  openWindow(mockChrome, w1.id, 'ts-a', 1);
  // ADR 0006 allows this: one page per window, the same tabverse in both
  const manager = mockChrome.insertTabFromData(
    {
      title: 'Tabverse',
      url: managerUrl('ts-a'),
      favIconUrl: '',
      pinned: true,
    },
    w2.id,
  );
  expect(mockChrome.getTab(manager.id)?.windowId).toEqual(w2.id);

  const open = await queryOpenTabSpaces();
  expect(open.filter((o) => o.tabSpaceId === 'ts-a')).toHaveLength(2);
  // this page is ts-a, so its own id is excluded even in the other window
  expect(
    otherWindowTabSpaces(open, { windowId: w1.id, tabSpaceId: 'ts-a' }),
  ).toEqual([]);
});

test('the name and the tab count come out of IndexedDB, keyed by that id', async () => {
  await db.table('SavedTabSpace').bulkPut([
    // what tabSpaceBootstrap writes: a name before the first tab event
    savedTabSpace('ts-a', 'Window-1', ['t1', 't2']),
    // what a user rename leaves behind
    savedTabSpace('ts-b', 'Recipes for the week', ['t3', 't4', 't5']),
  ]);
  await db
    .table('SavedTab')
    .bulkPut([
      savedTab('t1', 'ts-a', 'one'),
      savedTab('t2', 'ts-a', 'two'),
      savedTab('t3', 'ts-b', 'three'),
      savedTab('t4', 'ts-b', 'four'),
      savedTab('t5', 'ts-b', 'five'),
    ]);

  const mockChrome = getMockChrome();
  const w1 = mockChrome.addWindow();
  const w2 = mockChrome.addWindow();
  openWindow(mockChrome, w1.id, 'ts-a', 2);
  openWindow(mockChrome, w2.id, 'ts-b', 3);
  const neighbours = otherWindowTabSpaces(await queryOpenTabSpaces(), {
    windowId: w1.id,
    tabSpaceId: 'ts-a',
  });

  // the join: window -> id -> saved row
  const rows = await loadTabSpacesByIds(neighbours.map((n) => n.tabSpaceId));
  expect(rows).toHaveLength(neighbours.length);
  expect(rows.map((r) => [r.id, r.name, r.tabs.size])).toEqual([
    ['ts-b', 'Recipes for the week', 3],
  ]);
});

test('the gap: a tabverse whose row is not here yet has no name to show', async () => {
  // the other window just opened and has not written its row, or its row was
  // written by a build that is gone. The window is real either way.
  await db
    .table('SavedTabSpace')
    .bulkPut([savedTabSpace('ts-a', 'Window-1', ['t1'])]);
  await db.table('SavedTab').bulkPut([savedTab('t1', 'ts-a', 'one')]);

  const mockChrome = getMockChrome();
  const w1 = mockChrome.addWindow();
  const w2 = mockChrome.addWindow();
  openWindow(mockChrome, w1.id, 'ts-a', 1);
  openWindow(mockChrome, w2.id, 'ts-brand-new', 1);

  const neighbours = otherWindowTabSpaces(await queryOpenTabSpaces(), {
    windowId: w1.id,
    tabSpaceId: 'ts-a',
  });
  expect(neighbours.map((n) => n.tabSpaceId)).toEqual(['ts-brand-new']);

  // loadTabSpacesByIds drops what it cannot find, so the row count is smaller
  // than the window count: the view has to render a fallback, not an empty list
  const rows = await loadTabSpacesByIds(neighbours.map((n) => n.tabSpaceId));
  expect(rows).toEqual([]);
});

test('the list is computed from a tab list, so it is testable without chrome', () => {
  // the pure half, in the shape the sidebar will call it
  const tabs = [
    { id: 1, windowId: 1, url: managerUrl('ts-a') },
    { id: 2, windowId: 1, url: 'https://example.com/' },
    { id: 3, windowId: 2, url: managerUrl('ts-b') },
  ] as chrome.tabs.Tab[];

  expect(
    otherWindowTabSpaces(openTabSpacesOf(tabs), {
      windowId: 1,
      tabSpaceId: 'ts-a',
    }),
  ).toEqual([{ tabSpaceId: 'ts-b', chromeTabId: 3, chromeWindowId: 2 }]);
});
// ---------------------------------------------------------------------------
// Opening a tabverse that is already open must go to it, not duplicate it.
//
// A duplicate is not cosmetic: both pages hold the same id and both autosave
// it, so the two windows overwrite each other's SavedTabSpace.tabIds and the
// tabverse's tab list flip-flops between them.
// ---------------------------------------------------------------------------

const open = (
  tabSpaceId: string,
  chromeTabId: number,
  chromeWindowId: number,
): OpenTabSpace => ({
  tabSpaceId,
  chromeTabId,
  chromeWindowId,
});

test('the plan is "switch" when the tabverse is open, "create" when it is not', () => {
  const openTabSpaces = [open('ts-a', 1, 1), open('ts-b', 3, 2)];

  expect(planOpenTabSpace(openTabSpaces, 'ts-b')).toEqual({
    kind: 'switch',
    open: open('ts-b', 3, 2),
  });
  expect(planOpenTabSpace(openTabSpaces, 'ts-elsewhere')).toEqual({
    kind: 'create',
  });
  expect(planOpenTabSpace([], 'ts-a')).toEqual({ kind: 'create' });
});

test('a tabverse open in two windows switches to the first of them', () => {
  // the duplicate this rule exists to prevent can still be on screen from an
  // older build; switching to one of them is the best available answer
  expect(
    planOpenTabSpace([open('ts-a', 1, 1), open('ts-a', 9, 7)], 'ts-a'),
  ).toEqual({ kind: 'switch', open: open('ts-a', 1, 1) });
});

test('the door switches when it can and creates when it cannot', async () => {
  const switched: number[] = [];
  let created = 0;

  const alreadyOpen = await openOrSwitchToTabSpace('ts-a', {
    query: async () => [open('ts-a', 5, 2)],
    switchTo: async (target) => {
      switched.push(target.chromeTabId);
    },
    create: () => {
      created += 1;
    },
  });
  expect(alreadyOpen).toEqual('switch');
  expect(switched).toEqual([5]);
  expect(created).toEqual(0);

  const brandNew = await openOrSwitchToTabSpace('ts-b', {
    query: async () => [open('ts-a', 5, 2)],
    switchTo: async (target) => {
      switched.push(target.chromeTabId);
    },
    create: () => {
      created += 1;
    },
  });
  expect(brandNew).toEqual('create');
  expect(created).toEqual(1);
  expect(switched).toEqual([5]);
});

test('opening the same tabverse twice opens one window, not two', async () => {
  const mockChrome = getMockChrome();
  mockChrome.addWindow(); // the window the user is working in

  await restoreSavedTabSpaceUtil('ts-a');
  expect(mockChrome.mockWindows).toHaveLength(2);
  const openedIn = mockChrome.mockWindows[1];
  const managerTab = (await chrome.tabs.query({ windowId: openedIn.id }))[0];
  expect(managerTab.url).toContain('tvid=ts-a');

  // the second ask is answered by going to the window that has it
  await restoreSavedTabSpaceUtil('ts-a');
  expect(mockChrome.mockWindows).toHaveLength(2);
  expect(mockChrome.currentWindowId).toEqual(openedIn.id);
  const managerTabs = (await chrome.tabs.query({})).filter((tab) =>
    (tab.url ?? '').includes('tvid=ts-a'),
  );
  expect(managerTabs).toHaveLength(1);
});

test('a tabverse open in a window the user did not ask about is still switched to', async () => {
  const mockChrome = getMockChrome();
  const working = mockChrome.addWindow();
  const other = mockChrome.addWindow();
  openWindow(mockChrome, other.id, 'ts-open-elsewhere', 1);
  mockChrome.setCurrentWindow(working.id);

  await restoreSavedTabSpaceUtil('ts-open-elsewhere');

  // no new window, and the window that has it is in front
  expect(mockChrome.mockWindows).toHaveLength(2);
  expect(mockChrome.currentWindowId).toEqual(other.id);
});
