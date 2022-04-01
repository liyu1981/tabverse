import {
  getTabSpaceChromeTabIds,
  setupMockChromeAndTabSpaceWithMonitoring,
} from './common.test';

test('onCreated', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, tst1 } =
    await setupMockChromeAndTabSpaceWithMonitoring();

  mockChrome.moveTab(t2.id, 3);
  await mockChrome.flushMessages();
  expect(getTabSpaceChromeTabIds()).toEqual([t1.id, t3.id, t2.id]);
});
