import { omit } from 'lodash';
import { resetTestDb } from '../../../dev/dbImplTest';
import {
  initMockChrome,
  tsTabData1,
} from '../../tabSpace/__tests__/common.test';
import { tabSpaceBootstrap } from '../../tabSpaceBootstrap';
import {
  deleteSavedTabSpace,
  monitorTabSpaceChanges,
  querySavedTabSpace,
  querySavedTabSpaceById,
  saveCurrentTabSpace,
} from '../../tabSpace/util';
import { $tabSpace } from '../../tabSpace/store';
import { findTabByChromeTabId } from '../../tabSpace/TabSpace';
import { QUERY_PAGE_LIMIT_DEFAULT } from '../../../storage/db';

export async function initTabSpaceData() {
  // storeManagerBootstrap();
  const { mockChrome, w1, w2, t1, t2, t3, t4 } = initMockChrome();
  const tst1 = mockChrome.insertTabFromData(tsTabData1, w1.id, 0);
  await mockChrome.flushMessages();
  await tabSpaceBootstrap(tst1.id, tst1.windowId);
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
    await saveCurrentTabSpace();
    const tabSpace2 = await querySavedTabSpaceById($tabSpace.getState().id);
    expect(omit(tabSpace2, ['chromeTabId', 'chromeWindowId', 'tabs'])).toEqual(
      omit($tabSpace.getState(), ['chromeTabId', 'chromeWindowId', 'tabs']),
    );

    const changedTitle = t1.title + 'changed';
    mockChrome.updateTab(t1.id, { title: changedTitle });
    await mockChrome.flushMessages();
    const tab1 = findTabByChromeTabId(t1.id, $tabSpace.getState());
    const savedTabSpace1 = await querySavedTabSpaceById(
      $tabSpace.getState().id,
    );
    const savedTab = savedTabSpace1.tabs.find(
      (savedTab) => savedTab.id === tab1.id,
    );
    expect(savedTab.title).toEqual(changedTitle);

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

    await deleteSavedTabSpace($tabSpace.getState().id);
    const savedTabSpaces = await querySavedTabSpace();
    expect(savedTabSpaces.length).toEqual(0);
  });
});
