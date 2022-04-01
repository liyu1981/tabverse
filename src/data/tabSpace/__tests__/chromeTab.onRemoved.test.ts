import { $tabSpace } from '../store';
import { findTabByChromeTabId, getTabIds } from '../TabSpace';
import { setupMockChromeAndTabSpaceWithMonitoring } from './common.test';

test('normal', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, tst1 } =
    await setupMockChromeAndTabSpaceWithMonitoring();

  const tab2 = findTabByChromeTabId(t2.id, $tabSpace.getState());
  mockChrome.removeTab(t2.id);
  await mockChrome.flushMessages();

  expect(findTabByChromeTabId(t2.id, $tabSpace.getState())).toBeUndefined();
  expect(getTabIds($tabSpace.getState()).includes(tab2.id)).toBeFalsy();
});
