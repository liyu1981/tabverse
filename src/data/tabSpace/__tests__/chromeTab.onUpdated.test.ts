import { $tabSpace } from '../store';
import { findTabByChromeTabId } from '../TabSpace';
import {
  getTabSpaceChromeTabIds,
  setupMockChromeAndTabSpaceWithMonitoring,
} from './common.test';

test('normal', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, tst1 } =
    await setupMockChromeAndTabSpaceWithMonitoring();

  mockChrome.setActiveTab(t2.id);
  const changedTitle = t2.title + 'changed';
  mockChrome.updateTab(t2.id, { title: changedTitle });
  await mockChrome.flushMessages();
  expect(getTabSpaceChromeTabIds()).toEqual([t1.id, t2.id, t3.id]);
  expect(findTabByChromeTabId(t2.id, $tabSpace.getState()).title).toEqual(
    changedTitle,
  );
});
