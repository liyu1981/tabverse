/**
 * The page-side store behind the sidebar's "In Other Windows" list.
 *
 * The join is the thing worth pinning: the browser says *where* a tabverse is
 * open, IndexedDB says *what it is called*, and the row has to survive the
 * second read coming back short.
 */

import { db } from '../../../storage/db';
import { getMockChrome } from '../../../dev/chromeMock';
import { resetTestDb } from '../../../dev/dbImplTest';
import {
  $otherWindowNames,
  $otherWindowRows,
  $otherWindowTabSpaces,
  $openTabSpaces,
  refreshOpenTabSpaces,
  setOpenTabSpacesSchedulerForTest,
  startMonitorOpenTabSpaces,
  switchToOtherWindow,
} from '../openWindowStore';
import { $tabSpace, tabSpaceStoreApi } from '../store';
import { TABSPACE_MANAGER_TAB_URL_PREFIX } from '../../../global';
import { TabSpaceLogLevel, setDebugLogLevel } from '../../../debug';

const managerUrl = (tvid: string) =>
  `${TABSPACE_MANAGER_TAB_URL_PREFIX}?op=new&tvid=${tvid}`;

function openWindow(
  mockChrome: ReturnType<typeof getMockChrome>,
  windowId: number,
  tvid: string,
  tabCount = 0,
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

function savedTabSpace(id: string, name: string, tabCount: number) {
  return {
    id,
    name,
    tabIds: Array.from({ length: tabCount }, (_, i) => `${id}-t${i}`),
    tabGroups: [],
    version: 10,
    createdAt: 1,
    updatedAt: 2,
  };
}

function savedTabs(id: string, tabCount: number) {
  return Array.from({ length: tabCount }, (_, i) => ({
    id: `${id}-t${i}`,
    tabSpaceId: id,
    title: `${id} page ${i}`,
    url: `https://example.com/${id}/${i}`,
    favIconUrl: '',
    pinned: false,
    createdAt: 1,
    updatedAt: 1,
    version: 10,
  }));
}

/** This page's own window and tabverse, as bootstrap would have set them. */
function beThisPage(
  mockChrome: ReturnType<typeof getMockChrome>,
  windowId: number,
  tabSpaceId: string,
) {
  tabSpaceStoreApi.reset({ chromeTabId: 1, chromeWindowId: windowId });
  tabSpaceStoreApi.updateTabSpace({ id: tabSpaceId });
  openWindow(mockChrome, windowId, tabSpaceId);
}

/** Effector stores are module state: each test starts from nothing open. */
beforeEach(async () => {
  // logger.error is silent under the default test log level (debug.ts), which
  // turns a swallowed exception into an unexplained empty list
  setDebugLogLevel(TabSpaceLogLevel.LOG);
  await resetTestDb();
  $openTabSpaces.reset();
  $otherWindowNames.reset();
  setOpenTabSpacesSchedulerForTest(null);
});

/** Lets the monitor's own (unawaited) first read finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test('the rows are the other windows, named and counted', async () => {
  const mockChrome = getMockChrome();
  const w1 = mockChrome.addWindow();
  const w2 = mockChrome.addWindow();
  const w3 = mockChrome.addWindow();
  beThisPage(mockChrome, w1.id, 'ts-self');
  openWindow(mockChrome, w2.id, 'ts-b', 3);
  openWindow(mockChrome, w3.id, 'ts-c', 1);
  await db
    .table('SavedTabSpace')
    .bulkPut([
      savedTabSpace('ts-b', 'Recipes for the week', 3),
      savedTabSpace('ts-c', 'Java concurrency notes', 1),
    ]);
  await db
    .table('SavedTab')
    .bulkPut([...savedTabs('ts-b', 3), ...savedTabs('ts-c', 1)]);

  await refreshOpenTabSpaces();
  expect($openTabSpaces.getState()).toHaveLength(3);
  expect($otherWindowTabSpaces.getState().map((o) => o.tabSpaceId)).toEqual([
    'ts-b',
    'ts-c',
  ]);
  // window order, not id order: the list must not shuffle under the cursor
  expect($otherWindowRows.getState()).toEqual([
    expect.objectContaining({
      tabSpaceId: 'ts-b',
      name: 'Recipes for the week',
      tabCount: 3,
      chromeWindowId: w2.id,
    }),
    expect.objectContaining({
      tabSpaceId: 'ts-c',
      name: 'Java concurrency notes',
      tabCount: 1,
      chromeWindowId: w3.id,
    }),
  ]);
});

test('a window whose tabverse has no saved row yet keeps its place', async () => {
  const mockChrome = getMockChrome();
  const w1 = mockChrome.addWindow();
  const w2 = mockChrome.addWindow();
  beThisPage(mockChrome, w1.id, 'ts-self');
  // no SavedTabSpace row for this one: its window opened a moment ago
  openWindow(mockChrome, w2.id, 'ts-brand-new', 1);

  await refreshOpenTabSpaces();

  expect($otherWindowRows.getState()).toEqual([
    expect.objectContaining({
      tabSpaceId: 'ts-brand-new',
      name: '',
      tabCount: 0,
    }),
  ]);
});

test('this window is never one of its own neighbours', async () => {
  const mockChrome = getMockChrome();
  const w1 = mockChrome.addWindow();
  const w2 = mockChrome.addWindow();
  beThisPage(mockChrome, w1.id, 'ts-self');
  openWindow(mockChrome, w2.id, 'ts-other', 1);

  await refreshOpenTabSpaces();
  expect($otherWindowRows.getState().map((r) => r.tabSpaceId)).toEqual([
    'ts-other',
  ]);

  // and the store follows this page's identity: the same browser, asked as a
  // different window, answers differently
  tabSpaceStoreApi.reset({ chromeTabId: 1, chromeWindowId: w2.id });
  tabSpaceStoreApi.updateTabSpace({ id: 'ts-other' });
  expect($otherWindowRows.getState().map((r) => r.tabSpaceId)).toEqual([
    'ts-self',
  ]);
});

test('one tabverse open in two windows is two rows, and either can be switched to', async () => {
  const mockChrome = getMockChrome();
  const w1 = mockChrome.addWindow();
  const w2 = mockChrome.addWindow();
  const w3 = mockChrome.addWindow();
  beThisPage(mockChrome, w1.id, 'ts-self');
  openWindow(mockChrome, w2.id, 'ts-twice', 1);
  openWindow(mockChrome, w3.id, 'ts-twice', 1);

  await refreshOpenTabSpaces();

  const rows = $otherWindowRows.getState();
  expect(rows.map((r) => r.chromeWindowId)).toEqual([w2.id, w3.id]);

  mockChrome.setCurrentWindow(w1.id);
  await switchToOtherWindow(rows[1]);
  expect(mockChrome.currentWindowId).toEqual(w3.id);
});

test('the monitor re-reads on a tab event, and stops when told to', async () => {
  // A controllable clock: the debounce is what keeps a window restore (dozens of
  // events) down to one read, so it is the thing a test has to be able to drive.
  const live = new Map<number, () => void>();
  let nextHandle = 0;
  setOpenTabSpacesSchedulerForTest({
    setTimeout: (fn) => {
      live.set(++nextHandle, fn);
      return nextHandle;
    },
    clearTimeout: (handle) => {
      live.delete(handle as number);
    },
  });
  /** Runs the reads the debounce left pending. */
  const runScheduled = () => {
    const pending = Array.from(live.values());
    live.clear();
    pending.forEach((fn) => {
      fn();
    });
  };

  const mockChrome = getMockChrome();
  const w1 = mockChrome.addWindow();
  const w2 = mockChrome.addWindow();
  beThisPage(mockChrome, w1.id, 'ts-self');
  const stop = startMonitorOpenTabSpaces();
  await settle();
  expect($openTabSpaces.getState()).toHaveLength(1); // the first read

  // a burst: a new window, a new tab, a closed tab
  openWindow(mockChrome, w2.id, 'ts-later', 1);
  mockChrome.insertTabFromData(
    {
      title: 'x',
      url: 'https://example.com/x',
      favIconUrl: '',
      pinned: false,
    },
    w2.id,
  );
  mockChrome.removeTab(999);
  await mockChrome.flushMessages();

  // one read scheduled, not three: the debounce kept only the last
  expect(live.size).toEqual(1);
  runScheduled();
  await settle();
  expect($openTabSpaces.getState().map((o) => o.tabSpaceId)).toEqual([
    'ts-self',
    'ts-later',
  ]);

  stop();
  openWindow(mockChrome, w2.id, 'ts-after-stop', 1);
  await mockChrome.flushMessages();
  expect(live.size).toEqual(0);
  expect($openTabSpaces.getState().map((o) => o.tabSpaceId)).not.toContain(
    'ts-after-stop',
  );
});

test("this page's own tabverse is the one $tabSpace says it is", () => {
  // the guard on the whole thing: "other" is decided by the live window id and
  // this page's id, both of which come from $tabSpace, never from the url
  const mockChrome = getMockChrome();
  const w1 = mockChrome.addWindow();
  beThisPage(mockChrome, w1.id, 'ts-self');
  expect($tabSpace.getState().chromeWindowId).toEqual(w1.id);
  expect($tabSpace.getState().id).toEqual('ts-self');
});
