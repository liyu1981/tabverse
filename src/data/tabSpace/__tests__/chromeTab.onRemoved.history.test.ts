import { $allClosedTab, closedTabStoreApi } from '../../closedTab/store';
import { $tabSpace } from '../store';
import { findTabByChromeTabId, getTabIds } from '../TabSpace';
import { saveAllClosedTabs } from '../../closedTab/util';
import { setupMockChromeAndTabSpaceWithMonitoring } from './common.test';

import { CLOSED_TAB_DB_TABLE_NAME } from '../../closedTab/ClosedTab';
import { newEmptyAllClosedTab } from '../../closedTab/AllClosedTab';
import { db } from '../../../storage/db';
import { resetTestDb } from '../../../dev/dbImplTest';

beforeEach(async () => {
  await resetTestDb();
  // the history store is module state, one tabverse at a time
  closedTabStoreApi.update(newEmptyAllClosedTab());
});

async function historyUrls() {
  await saveAllClosedTabs();
  const rows = await db.table(CLOSED_TAB_DB_TABLE_NAME).toArray();
  return rows.map((row) => row.url).sort();
}

test('closing a tab records it in the history of this tabverse', async () => {
  const { mockChrome, t1, t2, t3 } =
    await setupMockChromeAndTabSpaceWithMonitoring();
  const tabSpaceId = $tabSpace.getState().id;

  const closedTab = findTabByChromeTabId(t2.id, $tabSpace.getState());
  mockChrome.removeTab(t2.id);
  await mockChrome.flushMessages();

  expect(findTabByChromeTabId(t2.id, $tabSpace.getState())).toBeUndefined();
  expect(getTabIds($tabSpace.getState()).includes(closedTab.id)).toBeFalsy();

  const recorded = $allClosedTab.getState().closedTabs.toArray();
  expect(recorded.length).toBe(1);
  expect(recorded[0].url).toEqual(closedTab.url);
  expect(recorded[0].title).toEqual(closedTab.title);
  expect(recorded[0].tabSpaceId).toEqual(tabSpaceId);
  // the store is only a cache; the row has to reach the database too
  expect(await historyUrls()).toEqual([closedTab.url]);
});

test('closing several tabs records each of them, newest first', async () => {
  // t1 and t3 are the same url on purpose for other tests, so use the two
  // distinct ones here
  const { mockChrome, t1, t2 } =
    await setupMockChromeAndTabSpaceWithMonitoring();
  const urlOfT1 = findTabByChromeTabId(t1.id, $tabSpace.getState()).url;
  const urlOfT2 = findTabByChromeTabId(t2.id, $tabSpace.getState()).url;

  mockChrome.removeTab(t1.id);
  await mockChrome.flushMessages();
  mockChrome.removeTab(t2.id);
  await mockChrome.flushMessages();

  const recorded = $allClosedTab.getState().closedTabs.toArray();
  expect(recorded.map((t) => t.url)).toEqual([urlOfT2, urlOfT1]);
  expect(await historyUrls()).toEqual([urlOfT1, urlOfT2].sort());
});

test('closing a tab twice keeps one entry with a counter', async () => {
  const { mockChrome, t1 } = await setupMockChromeAndTabSpaceWithMonitoring();
  const url = findTabByChromeTabId(t1.id, $tabSpace.getState()).url;

  mockChrome.removeTab(t1.id);
  await mockChrome.flushMessages();
  // the same page comes back and is closed again
  const reopened = mockChrome.insertTabFromData(
    { title: 'again', url, favIconUrl: '', pinned: false },
    t1.windowId,
  );
  await mockChrome.flushMessages();
  mockChrome.removeTab(reopened.id);
  await mockChrome.flushMessages();

  const recorded = $allClosedTab.getState().closedTabs.toArray();
  expect(recorded.length).toBe(1);
  expect(recorded[0].url).toEqual(url);
  expect(recorded[0].timesClosed).toBe(2);
  expect(await historyUrls()).toEqual([url]);
});

test('a tab of another window is not part of this history', async () => {
  const { mockChrome, t4 } = await setupMockChromeAndTabSpaceWithMonitoring();

  mockChrome.removeTab(t4.id);
  await mockChrome.flushMessages();

  expect($allClosedTab.getState().closedTabs.size).toEqual(0);
  expect(await historyUrls()).toEqual([]);
});
