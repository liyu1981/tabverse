import { $tabSpace } from '../store';
import { findTabById, getTabIds } from '../TabSpace';
import {
  getTabSpaceChromeTabIds,
  setupMockChromeAndTabSpaceWithMonitoring,
  tabData1,
} from './common.test';

test('normal', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, tst1 } =
    await setupMockChromeAndTabSpaceWithMonitoring();

  const newt = mockChrome.replaceTabFromData(tabData1, t2.id);
  await mockChrome.flushMessages();
  expect(getTabSpaceChromeTabIds()).toEqual([t1.id, newt.id, t3.id]);
  expect(
    findTabById(
      getTabIds($tabSpace.getState())[t2.position],
      $tabSpace.getState(),
    ).url,
  ).toEqual(tabData1.url);
});
