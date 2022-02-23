import {
  createNewTabSpaceData,
  getTabSpaceChromeTabIds,
  tabData1,
  tabData2,
  tsTabData1,
} from './common.test';

import { getMockChrome } from '../../../dev/chromeMock';
import { scanCurrentTabs } from '../chromeTab';

export function initMockChrome() {
  const mockChrome = getMockChrome();
  const w1 = mockChrome.addWindow();
  const w2 = mockChrome.addWindow();
  const t1 = mockChrome.insertTabFromData(tabData1, w1.id);
  const t2 = mockChrome.insertTabFromData(tabData2, w1.id);
  const t3 = mockChrome.insertTabFromData(tabData1, w1.id);
  const t4 = mockChrome.insertTabFromData(tabData2, w2.id);
  return { mockChrome, w1, w2, t1, t2, t3, t4 };
}

test('scanCurrentTabs', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4 } = initMockChrome();

  const tst1 = mockChrome.insertTabFromData(tsTabData1, w1.id, 0);
  await mockChrome.flushMessages();
  const d = createNewTabSpaceData(tst1.id, tst1.windowId);
  await scanCurrentTabs(d);

  expect(getTabSpaceChromeTabIds(d)).toEqual([t1.id, t2.id, t3.id]);
  expect(d.tabSpace.chromeTabId).toBe(tst1.id);
  expect(d.tabSpace.chromeWindowId).toBe(tst1.windowId);
});
