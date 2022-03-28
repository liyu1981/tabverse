import { QUERY_PAGE_LIMIT_DEFAULT } from '../../../store/storage';
import { resetTestDb } from '../../../dev/dbImplTest';
import { startMonitorTabChanges } from '../chromeTab';
import { bootstrap as storageManagerBootstrap } from '../../../store/bootstrap';
import { initMockChrome, tsTabData1 } from './common.test';
import { $tabSpace, tabSpaceStoreApi } from '../store';
import {
  deleteSavedTabSpace,
  querySavedTabSpace,
  querySavedTabSpaceById,
  saveCurrentTabSpace,
} from '../util';
import { findTabByChromeTabId } from '../TabSpace';
import { pick } from 'lodash';

export async function initTabSpaceData() {
  storageManagerBootstrap();
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
