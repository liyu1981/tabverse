import { $tabSpace } from '../store';
import {
  getTabSpaceChromeTabIds,
  setupMockChromeAndTabSpaceWithMonitoring,
  tabData1,
} from './common.test';

test('onCreated', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, tst1 } =
    await setupMockChromeAndTabSpaceWithMonitoring();

  const newt = mockChrome.insertTabFromData(tabData1, w1.id);
  await mockChrome.flushMessages();
  expect(getTabSpaceChromeTabIds()).toEqual([t1.id, t2.id, t3.id, newt.id]);

  const oldSize = $tabSpace.getState().tabs.size;
  const newt2 = mockChrome.insertTabFromData(tabData1, w2.id);
  await mockChrome.flushMessages();
  expect($tabSpace.getState().tabs.size).toEqual(oldSize);
});
