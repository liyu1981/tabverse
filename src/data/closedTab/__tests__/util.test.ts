import { $allClosedTab, closedTabStoreApi } from '../store';
import {
  CLOSED_TAB_DB_TABLE_NAME,
  ClosedTab,
  HISTORY_MAX_ENTRIES,
} from '../ClosedTab';
import { TabCore, TAB_DB_TABLE_NAME } from '../../tabSpace/Tab';
import { mergeHistoryByUrl } from '../historyFilter';
import {
  clearAllClosedTabs,
  deleteClosedTab,
  loadClosedTabsByTabSpaceId,
  queryClosedTabs,
  recordClosedTab,
  restoreClosedTab,
  saveAllClosedTabs,
  startMonitorDbChanges,
} from '../util';

import { tabSpaceStoreApi } from '../../tabSpace/store';
import { TabSpaceDBMsg, sendPubSubMessage } from '../../../message/message';
import { getMockChrome } from '../../../dev/chromeMock';
import { newEmptyAllClosedTab } from '../AllClosedTab';
import { resetTestDb } from '../../../dev/dbImplTest';
import { TABSPACE_DB_TABLE_NAME } from '../../tabSpace/TabSpace';
import { db } from '../../../storage/db';
import { vi } from 'vitest';

const mockChrome = getMockChrome();
const TABSPACE_ID = 'tabspace-under-test';

function aTab(url: string, title = url): TabCore {
  return {
    version: 10,
    id: `chrome-less-${url}`,
    createdAt: 1,
    updatedAt: 1,
    tabSpaceId: TABSPACE_ID,
    title,
    url,
    favIconUrl: `${url}/icon`,
    pinned: false,
    suspended: false,
  };
}

async function rowsInDb(): Promise<ClosedTab[]> {
  return db.table<ClosedTab>(CLOSED_TAB_DB_TABLE_NAME).toArray();
}

beforeEach(async () => {
  await resetTestDb();
  closedTabStoreApi.update(newEmptyAllClosedTab());
  tabSpaceStoreApi.updateTabSpace({ id: TABSPACE_ID });
});

test('record, save and load a closed tab', async () => {
  await loadClosedTabsByTabSpaceId(TABSPACE_ID);
  expect($allClosedTab.getState().closedTabs.size).toEqual(0);

  recordClosedTab(aTab('https://www.test1.com', 'test one'), 1000);
  recordClosedTab(aTab('https://www.test2.com', 'test two'), 2000);
  await saveAllClosedTabs();

  const rows = await rowsInDb();
  expect(rows.length).toEqual(2);
  rows.forEach((row) => {
    expect(row.tabSpaceId).toEqual(TABSPACE_ID);
    // a live tab is never stored in the history
    expect((row as any).chromeTabId).toBeUndefined();
  });

  // a fresh read of the tabverse comes back newest first
  closedTabStoreApi.update(newEmptyAllClosedTab());
  await loadClosedTabsByTabSpaceId(TABSPACE_ID);
  const loaded = $allClosedTab.getState().closedTabs;
  expect(loaded.map((t) => t.url).toArray()).toEqual([
    'https://www.test2.com',
    'https://www.test1.com',
  ]);
  expect(loaded.first().title).toEqual('test two');
});

test('a tab closed twice is one row with a counter', async () => {
  recordClosedTab(aTab('https://www.test1.com'), 1000);
  recordClosedTab(aTab('https://www.test1.com'), 2000);
  await saveAllClosedTabs();

  const rows = await rowsInDb();
  expect(rows.length).toEqual(1);
  expect(rows[0].timesClosed).toEqual(2);
  expect(rows[0].closedAt).toEqual(2000);
});

test('a tab without a url is not recorded', async () => {
  recordClosedTab(aTab(''), 1000);
  await saveAllClosedTabs();
  expect((await rowsInDb()).length).toEqual(0);
});

test('history is per tabverse', async () => {
  recordClosedTab(aTab('https://www.mine.com'), 1000);
  await saveAllClosedTabs();

  tabSpaceStoreApi.updateTabSpace({ id: 'another-tabspace' });
  await loadClosedTabsByTabSpaceId('another-tabspace');
  expect($allClosedTab.getState().closedTabs.size).toEqual(0);
  expect((await queryClosedTabs(TABSPACE_ID)).length).toEqual(1);
});

test('a tab closed after the window became another tabverse is recorded there', async () => {
  // the window was tabspace A, with history of its own
  recordClosedTab(aTab('https://www.mine.com'), 1000);
  await saveAllClosedTabs();

  // tabspace B has history too, and the window is now B (what a restore does)
  tabSpaceStoreApi.updateTabSpace({ id: 'tabspace-b' });
  await loadClosedTabsByTabSpaceId('tabspace-b');
  recordClosedTab(aTab('https://www.b.com'), 2000);
  await saveAllClosedTabs();
  tabSpaceStoreApi.updateTabSpace({ id: 'tabspace-b' });

  // the store is on B, but the case that lost history is a store still holding
  // A's rows - which is what a restore leaves when the History panel was not
  // open - when the first tab of B is closed
  tabSpaceStoreApi.updateTabSpace({ id: TABSPACE_ID });
  await loadClosedTabsByTabSpaceId(TABSPACE_ID);
  tabSpaceStoreApi.updateTabSpace({ id: 'tabspace-b' });

  recordClosedTab(aTab('https://www.closed-in-b.com'), 3000);
  await vi.waitFor(() =>
    expect($allClosedTab.getState().tabSpaceId).toEqual('tabspace-b'),
  );
  await saveAllClosedTabs();

  // B keeps its own row and gains the new one
  expect(
    (await queryClosedTabs('tabspace-b')).map((row) => row.url).sort(),
  ).toEqual(['https://www.b.com', 'https://www.closed-in-b.com']);
  // and A's history is still A's: not re-labelled, and not deleted as stale
  // (those deletes are what the change feed pushed to the server)
  expect((await queryClosedTabs(TABSPACE_ID)).map((row) => row.url)).toEqual([
    'https://www.mine.com',
  ]);
});

test('a burst of closes across the tabverse switch is not lost', async () => {
  recordClosedTab(aTab('https://www.mine.com'), 1000);
  await saveAllClosedTabs();
  tabSpaceStoreApi.updateTabSpace({ id: 'tabspace-b' });

  // closing a window fires onRemoved per tab, and they all land while the one
  // load of the new tabverse's rows is in flight
  recordClosedTab(aTab('https://www.one.com'), 2000);
  recordClosedTab(aTab('https://www.two.com'), 3000);
  recordClosedTab(aTab('https://www.three.com'), 4000);
  await vi.waitFor(() =>
    expect($allClosedTab.getState().closedTabs.size).toEqual(3),
  );
  await saveAllClosedTabs();

  expect(
    (await queryClosedTabs('tabspace-b')).map((row) => row.url).sort(),
  ).toEqual([
    'https://www.one.com',
    'https://www.three.com',
    'https://www.two.com',
  ]);
  expect((await queryClosedTabs(TABSPACE_ID)).map((row) => row.url)).toEqual([
    'https://www.mine.com',
  ]);
});

test('the oldest rows are deleted once the cap is reached', async () => {
  for (let i = 0; i < HISTORY_MAX_ENTRIES + 3; i += 1) {
    closedTabStoreApi.addClosedTab({
      ...aTab(`https://www.test${i}.com`),
      id: `entry-${i}`,
      tabSpaceId: TABSPACE_ID,
      closedAt: 1000 + i,
      timesClosed: 1,
      version: 10,
      createdAt: 1000 + i,
      updatedAt: 1000 + i,
    });
  }
  await saveAllClosedTabs();

  const rows = await rowsInDb();
  expect(rows.length).toEqual(HISTORY_MAX_ENTRIES);
  expect(
    rows.find((row) => row.url === 'https://www.test0.com'),
  ).toBeUndefined();
  expect(
    rows.find(
      (row) => row.url === `https://www.test${HISTORY_MAX_ENTRIES + 2}.com`,
    ),
  ).toBeTruthy();
  // the store agrees with the database
  expect($allClosedTab.getState().closedTabs.size).toEqual(HISTORY_MAX_ENTRIES);
});

test('delete and clear remove the rows from the database too', async () => {
  recordClosedTab(aTab('https://www.test1.com'), 1000);
  recordClosedTab(aTab('https://www.test2.com'), 2000);
  await saveAllClosedTabs();
  expect((await rowsInDb()).length).toEqual(2);

  const [first] = $allClosedTab.getState().closedTabs.toArray();
  deleteClosedTab(first);
  await saveAllClosedTabs();
  expect((await rowsInDb()).length).toEqual(1);
  expect($allClosedTab.getState().closedTabs.size).toEqual(1);

  clearAllClosedTabs();
  await saveAllClosedTabs();
  expect((await rowsInDb()).length).toEqual(0);
  expect($allClosedTab.getState().closedTabs.size).toEqual(0);
});

test('restore reopens the url in the current window', async () => {
  const w1 = mockChrome.addWindow();
  mockChrome.setCurrentWindow(w1.id);
  const entry = aTab('https://www.test1.com', 'test one');

  const closedTab: ClosedTab = { ...entry, closedAt: 1, timesClosed: 1 };
  expect(await restoreClosedTab(closedTab)).toBe(true);
  const tabs = await chrome.tabs.query({ currentWindow: true });
  expect(tabs.some((t: any) => t.url === 'https://www.test1.com')).toBe(true);
});

test('restore reports a failure instead of throwing', async () => {
  const broken: ClosedTab = {
    ...aTab('https://www.test1.com'),
    closedAt: 1,
    timesClosed: 1,
  };
  const create = chrome.tabs.create;
  (chrome.tabs as any).create = () => {
    throw new Error('cannot open');
  };
  try {
    expect(await restoreClosedTab(broken)).toBe(false);
  } finally {
    (chrome.tabs as any).create = create;
  }
});

test('the db auditor purges history of a tabverse that is gone', async () => {
  await db
    .table(TABSPACE_DB_TABLE_NAME)
    .put({ id: TABSPACE_ID, tabIds: [], createdAt: 1, updatedAt: 1 } as any);
  await db.table(TAB_DB_TABLE_NAME).put({ id: 't1', createdAt: 1 });
  recordClosedTab(aTab('https://www.test1.com'), 1000);
  await saveAllClosedTabs();
  expect((await rowsInDb()).length).toEqual(1);

  // the tabverse is deleted (as the delete path does, leaving the history rows)
  await db.table(TABSPACE_DB_TABLE_NAME).delete(TABSPACE_ID);
  const logs: string[] = [];
  const { dbAuditor } = await import('../dbAuditor');
  await dbAuditor(logs);
  expect((await rowsInDb()).length).toEqual(0);
});

test('a history row written by another device reloads the open list', async () => {
  startMonitorDbChanges();
  closedTabStoreApi.update(newEmptyAllClosedTab());

  // an unrelated table must not disturb the history
  sendPubSubMessage(TabSpaceDBMsg.Changed, ['SavedNote']);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect($allClosedTab.getState().closedTabs.size).toEqual(0);

  await db.table(CLOSED_TAB_DB_TABLE_NAME).put({
    ...aTab('https://www.remote.com', 'closed elsewhere'),
    id: 'remote-1',
    closedAt: 1000,
    timesClosed: 1,
    createdAt: 1000,
    updatedAt: 1000,
  });
  sendPubSubMessage(TabSpaceDBMsg.Changed, [CLOSED_TAB_DB_TABLE_NAME]);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const loaded = $allClosedTab.getState().closedTabs.toArray();
  expect(loaded.length).toEqual(1);
  expect(loaded[0].url).toEqual('https://www.remote.com');
});

test('history survives a reload: a page that closes a tab before opening History prunes nothing', async () => {
  // the tabverse's history, as an earlier session left it
  recordClosedTab(aTab('https://www.one.com'), 1000);
  recordClosedTab(aTab('https://www.two.com'), 2000);
  await saveAllClosedTabs();
  expect((await queryClosedTabs(TABSPACE_ID)).length).toEqual(2);

  // a reload: the page's in-memory store is new, the rows are not. This is what
  // `chrome://extensions` -> Reload, a browser restart and a second tabverse in
  // the same window all look like from here.
  closedTabStoreApi.update(newEmptyAllClosedTab());
  expect($allClosedTab.getState().mayPrune).toBe(false);

  // the user closes a tab before ever opening the History panel
  recordClosedTab(aTab('https://www.three.com'), 3000);
  await saveAllClosedTabs();

  // the two earlier rows are still there: a store that has read nothing must not
  // prune what it has not read, and those deletes went to the server as
  // tombstones, so losing them here lost them on every device
  expect(
    (await queryClosedTabs(TABSPACE_ID)).map((row) => row.url).sort(),
  ).toEqual([
    'https://www.one.com',
    'https://www.three.com',
    'https://www.two.com',
  ]);
  // and the panel, when it is finally opened, reads all three
  await loadClosedTabsByTabSpaceId(TABSPACE_ID);
  expect($allClosedTab.getState().closedTabs.size).toEqual(3);
});

test('a store that has read the history does prune it', async () => {
  // the counterpart, so the guard above cannot turn into "never delete anything"
  await loadClosedTabsByTabSpaceId(TABSPACE_ID);
  expect($allClosedTab.getState().mayPrune).toBe(true);
  recordClosedTab(aTab('https://www.one.com'), 1000);
  await saveAllClosedTabs();
  recordClosedTab(aTab('https://www.two.com'), 2000);
  await saveAllClosedTabs();
  expect((await queryClosedTabs(TABSPACE_ID)).length).toEqual(2);

  // newest first, so this is the row just recorded
  const [newest] = $allClosedTab.getState().closedTabs.toArray();
  deleteClosedTab(newest);
  await saveAllClosedTabs();

  expect((await queryClosedTabs(TABSPACE_ID)).map((row) => row.url)).toEqual([
    'https://www.one.com',
  ]);
});

/**
 * Deleting a row is a local edit that must win over work already in flight.
 *
 * The History tool saves whenever a tab is closed, so a click can land while a
 * save's store snapshot (or the worker's "SavedClosedTab changed" reload) is
 * already on its way back. Both used to end by replacing the store wholesale
 * with what they had read before the click, which put the deleted entry back -
 * and the save that followed wrote it to the database and pushed it to the
 * server again. Whether that happened depended on what was in flight, which is
 * why the same click "worked" one time and not the next.
 */
async function seedThreeRows() {
  await loadClosedTabsByTabSpaceId(TABSPACE_ID);
  recordClosedTab(aTab('https://a.example.com'), 1000);
  recordClosedTab(aTab('https://b.example.com'), 2000);
  recordClosedTab(aTab('https://c.example.com'), 3000);
  await saveAllClosedTabs();
  return $allClosedTab.getState().closedTabs;
}

test('a delete that lands during a save is not undone by that save', async () => {
  const seeded = await seedThreeRows();
  const doomed = seeded.find((t) => t.url === 'https://b.example.com')!;

  // the save takes its snapshot of the store now; the click lands after it
  const saving = saveAllClosedTabs();
  await Promise.resolve();
  deleteClosedTab(doomed);
  await saving;
  // the click scheduled its own save; let it run
  await saveAllClosedTabs();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(
    $allClosedTab.getState().closedTabs.some((t) => t.id === doomed.id),
  ).toBe(false);
  expect((await rowsInDb()).some((row) => row.id === doomed.id)).toBe(false);
});

test('a reload that was already reading does not bring a deleted entry back', async () => {
  const seeded = await seedThreeRows();
  const doomed = seeded.find((t) => t.url === 'https://c.example.com')!;

  // the worker said "SavedClosedTab changed", so the page re-read the table...
  const reloading = loadClosedTabsByTabSpaceId(TABSPACE_ID, {
    guardLocalEdits: true,
  });
  // ...and the person deleted a row before that read came back
  deleteClosedTab(doomed);
  await reloading;
  await saveAllClosedTabs();

  expect(
    $allClosedTab.getState().closedTabs.some((t) => t.id === doomed.id),
  ).toBe(false);
  expect((await rowsInDb()).some((row) => row.id === doomed.id)).toBe(false);
});

/**
 * One page, two rows.
 *
 * The model is one row per url (`ClosedTab`), and `recordClosedTab` keeps it by
 * folding a repeated close into the existing row. Sync does not: when another
 * device closed the same page, its row arrives with its own id, so the table -
 * and the list built from it - can hold the page twice. Deleting one row then
 * looked like a delete that did nothing, because the page was still on screen.
 * "Forget it" forgets the page.
 */
test('forget a page removes every copy of it', async () => {
  const twin = (id: string, closedAt: number) => ({
    ...aTab('https://www.github.com'),
    id,
    closedAt,
    timesClosed: 1,
    tabSpaceId: TABSPACE_ID,
    createdAt: closedAt,
    updatedAt: closedAt,
  });
  // two devices closed the same page: two rows in the table, two ids, one url
  await db
    .table(CLOSED_TAB_DB_TABLE_NAME)
    .bulkPut([
      twin('from-this-device', 1000),
      twin('from-the-other-one', 2000),
    ]);
  await loadClosedTabsByTabSpaceId(TABSPACE_ID);
  expect($allClosedTab.getState().closedTabs.size).toEqual(2);

  const clicked = $allClosedTab
    .getState()
    .closedTabs.find((t) => t.id === 'from-this-device')!;
  deleteClosedTab(clicked);
  await saveAllClosedTabs();

  expect(
    $allClosedTab.getState().closedTabs.some((t) => t.url === clicked.url),
  ).toBe(false);
  expect((await rowsInDb()).some((row) => row.url === clicked.url)).toBe(false);
});

test('the history of the window is one row per page, merged for the list', async () => {
  const twin = (id: string, closedAt: number, timesClosed: number) => ({
    ...aTab('https://www.github.com'),
    id,
    closedAt,
    timesClosed,
    tabSpaceId: TABSPACE_ID,
    createdAt: closedAt,
    updatedAt: closedAt,
  });
  await db.table(CLOSED_TAB_DB_TABLE_NAME).bulkPut([
    twin('copy-one', 1000, 1),
    twin('copy-two', 3000, 2),
    {
      ...aTab('https://www.example.com'),
      id: 'another-page',
      closedAt: 2000,
      timesClosed: 1,
      tabSpaceId: TABSPACE_ID,
      createdAt: 2000,
      updatedAt: 2000,
    },
  ]);
  await loadClosedTabsByTabSpaceId(TABSPACE_ID);

  // the table keeps both copies (they are two devices' rows) ...
  expect((await rowsInDb()).length).toEqual(3);
  // ... the list shows the page once, at the newest time, with the larger count
  const merged = mergeHistoryByUrl(
    $allClosedTab.getState().closedTabs.toArray(),
  );
  expect(merged.map((t) => t.url)).toEqual([
    'https://www.github.com',
    'https://www.example.com',
  ]);
  const github = merged.find((t) => t.url === 'https://www.github.com')!;
  expect(github.closedAt).toEqual(3000);
  expect(github.timesClosed).toEqual(2);
});
