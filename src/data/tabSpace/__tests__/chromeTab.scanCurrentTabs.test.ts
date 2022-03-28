import {
  getTabSpaceChromeTabIds,
  initMockChrome,
  initNewTabSpaceData,
  tsTabData1,
} from './common.test';

import { scanCurrentTabs } from '../chromeTab';
import { $tabSpace } from '../store';

test('scanCurrentTabs', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4 } = initMockChrome();

  const tst1 = mockChrome.insertTabFromData(tsTabData1, w1.id, 0);
  await mockChrome.flushMessages();

  initNewTabSpaceData(tst1.id, tst1.windowId, true);
  await scanCurrentTabs();

  expect(getTabSpaceChromeTabIds()).toEqual([t1.id, t2.id, t3.id]);
  expect($tabSpace.getState().chromeTabId).toBe(tst1.id);
  expect($tabSpace.getState().chromeWindowId).toBe(tst1.windowId);
});
