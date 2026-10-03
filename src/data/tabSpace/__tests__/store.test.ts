import { $tabSpace, tabSpaceStoreApi } from '../store';
import {
  deleteSavedTabSpace,
  querySavedTabSpace,
  querySavedTabSpaceById,
  saveCurrentTabSpace,
  saveTabSpace,
} from '../util';
import { initMockChrome, tsTabData1 } from './common.test';

import { QUERY_PAGE_LIMIT_DEFAULT } from '../../../storage/db';
import { findTabByChromeTabId } from '../TabSpace';
import { pick } from 'lodash';
import { resetTestDb } from '../../../dev/dbImplTest';
import { scanCurrentTabs, startMonitorTabChanges } from '../chromeTab';
import { fromLiveTab } from '../Tab';

export async function initTabSpaceData() {
  const { mockChrome, w1, w2, t1, t2, t3, t4 } = initMockChrome();
  const tst1 = mockChrome.insertTabFromData(tsTabData1, w1.id, 0);
  await mockChrome.flushMessages();
  tabSpaceStoreApi.updateTabSpace({
    chromeTabId: tst1.id,
    chromeWindowId: tst1.windowId,
  });
  return { mockChrome, w1, w2, t1, t2, t3, t4, tst1 };
}

export async function testWithDb(description: string, f: () => Promise<void>) {
  await f();
  await resetTestDb();
}

test('tabSpaceStore', async () => {
  await testWithDb('saveCurrentTabSpace', async () => {
    const { mockChrome, w1, w2, t1, t2, t3, t4, tst1 } =
      await initTabSpaceData();
    startMonitorTabChanges();
    await saveCurrentTabSpace();
    const tabSpace2 = await querySavedTabSpaceById($tabSpace.getState().id);
    expect(pick(tabSpace2, ['createdAt', 'id', 'name'])).toEqual(
      pick($tabSpace.getState(), ['createdAt', 'id', 'name']),
    );
    expect(tabSpace2.tabs.map((tab) => tab.id)).toEqual(
      $tabSpace.getState().tabs.map((tab) => tab.id),
    );

    const changedTitle = t1.title + 'changed';
    mockChrome.updateTab(t1.id, { title: changedTitle });
    await mockChrome.flushMessages();
    const tab1 = findTabByChromeTabId(t1.id, $tabSpace.getState());
    await saveCurrentTabSpace();
    const savedTabSpace2 = await querySavedTabSpaceById(
      $tabSpace.getState().id,
    );
    const savedTab = savedTabSpace2.tabs.find(
      (savedTab) => savedTab.id === tab1.id,
    );
    expect(savedTab.title).toEqual(changedTitle);
  });

  await testWithDb('deleteSavedTabSpace', async () => {
    const { mockChrome, w1, w2, t1, t2, t3, t4, tst1 } =
      await initTabSpaceData();
    startMonitorTabChanges();
    await saveCurrentTabSpace();
    await deleteSavedTabSpace($tabSpace.getState().id);
    const savedTabSpaces = await querySavedTabSpace();
    expect(savedTabSpaces.length).toEqual(0);
  });

  await testWithDb('querySavedTabSpace', async () => {
    const { mockChrome, w1, w2, t1, t2, t3, t4, tst1 } =
      await initTabSpaceData();
    startMonitorTabChanges();
    await saveCurrentTabSpace();
    const savedTabSpaces1 = await querySavedTabSpace({
      anyOf: [$tabSpace.getState().id],
    });
    expect(savedTabSpaces1.length).toEqual(1);
    const savedTabSpaces2 = await querySavedTabSpace({
      noneOf: [$tabSpace.getState().id],
    });
    expect(savedTabSpaces2.length).toEqual(0);
    const savedTabSpaces3 = await querySavedTabSpace({
      anyOf: [$tabSpace.getState().id],
      pageStart: 1,
      pageLimit: QUERY_PAGE_LIMIT_DEFAULT,
    });
    expect(savedTabSpaces3.length).toEqual(0);
  });
});

test('a tab that arrives while a save runs is saved by the merge after it', async () => {
  await testWithDb('merge after save', async () => {
    await initTabSpaceData();
    await scanCurrentTabs();
    const snapshot = $tabSpace.getState();
    expect(snapshot.tabs.size).toBeGreaterThan(0);

    // a tab lands in the store while that snapshot is being written: the burst
    // of tab events a split view creates does exactly this. The row being
    // written has no part of it, and the merge is what has to add it -
    // it was adding the copy it had just looked up and not found, i.e.
    // `undefined`, and immer threw before the re-save could run
    const late = fromLiveTab({
      chromeTabId: 9999,
      chromeWindowId: snapshot.chromeWindowId,
    });
    tabSpaceStoreApi.addTab(late);

    await saveTabSpace(snapshot);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const saved = await querySavedTabSpaceById(snapshot.id);
    // querySavedTabSpaceById hands back the tabverse with its tabs loaded
    expect(saved.tabs.size).toEqual(snapshot.tabs.size + 1);
    expect(saved.tabs.map((tab) => tab.id).toArray()).toContain(late.id);
    // and the live list still holds it too
    expect($tabSpace.getState().tabs.size).toEqual(snapshot.tabs.size + 1);
  });
});
