import { bootstrap, getTabSpaceData } from '../bootstrap';
import {
  deleteSavedTabSpace,
  querySavedTabSpace,
  querySavedTabSpaceById,
  saveCurrentTabSpace,
} from '../SavedTabSpaceStore';

import { initMockChrome } from './chromeTab.scanCurrentTabs.test';
import { omit } from 'lodash';
import { queryPageLimit } from '../../../store/store';
import { resetTestDb } from '../../../dev/dbImplTest';
import { startMonitorTabChanges } from '../chromeTab';
import { bootstrap as storeManagerBootstrap } from '../../../store/bootstrap';
import { tsTabData1 } from './common.test';

export async function initTabSpaceData() {
  storeManagerBootstrap();
  const { mockChrome, w1, w2, t1, t2, t3, t4 } = initMockChrome();
  const tst1 = mockChrome.insertTabFromData(tsTabData1, w1.id, 0);
  await mockChrome.flushMessages();
  await bootstrap(tst1.id, tst1.windowId);
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
    const { tabSpace } = getTabSpaceData();
    startMonitorTabChanges(getTabSpaceData());
    await saveCurrentTabSpace();
    const tabSpace2 = await querySavedTabSpaceById(tabSpace.id);
    expect(
      omit(tabSpace2.toJSON(), ['chromeTabId', 'chromeWindowId', 'tabs']),
    ).toEqual(
      omit(tabSpace.toJSON(), ['chromeTabId', 'chromeWindowId', 'tabs']),
    );

    const changedTitle = t1.title + 'changed';
    mockChrome.updateTab(t1.id, { title: changedTitle });
    await mockChrome.flushMessages();
    const tab1 = tabSpace.findTabByChromeTabId(t1.id);
    await saveCurrentTabSpace();
    const savedTabSpace2 = await querySavedTabSpaceById(tabSpace.id);
    const savedTab = savedTabSpace2.tabs.find(
      (savedTab) => savedTab.id === tab1.id,
    );
    expect(savedTab.title).toEqual(changedTitle);
  });

  await testWithDb('deleteSavedTabSpace', async () => {
    const { mockChrome, w1, w2, t1, t2, t3, t4, tst1 } =
      await initTabSpaceData();
    startMonitorTabChanges(getTabSpaceData());
    await saveCurrentTabSpace();
    const { tabSpace } = getTabSpaceData();
    await deleteSavedTabSpace(tabSpace.id);
    const savedTabSpaces = await querySavedTabSpace();
    expect(savedTabSpaces.length).toEqual(0);
  });

  await testWithDb('querySavedTabSpace', async () => {
    const { mockChrome, w1, w2, t1, t2, t3, t4, tst1 } =
      await initTabSpaceData();
    startMonitorTabChanges(getTabSpaceData());
    await saveCurrentTabSpace();
    const { tabSpace } = getTabSpaceData();

    const savedTabSpaces1 = await querySavedTabSpace({
      anyOf: [tabSpace.id],
    });
    expect(savedTabSpaces1.length).toEqual(1);
    const savedTabSpaces2 = await querySavedTabSpace({
      noneOf: [tabSpace.id],
    });
    expect(savedTabSpaces2.length).toEqual(0);
    const savedTabSpaces3 = await querySavedTabSpace({
      anyOf: [tabSpace.id],
      pageStart: 1,
      pageLimit: queryPageLimit,
    });
    expect(savedTabSpaces3.length).toEqual(0);
  });
});
