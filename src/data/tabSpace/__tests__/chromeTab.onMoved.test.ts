import {
  getTabSpaceChromeTabIds,
  setupMockChromeAndTabSpaceWithMonitoring,
} from './common.test';

test('onCreated', async () => {
  const { mockChrome, t1, t2, t3 } =
    await setupMockChromeAndTabSpaceWithMonitoring();

  mockChrome.moveTab(t2.id, 3);
  await mockChrome.flushMessages();
  expect(getTabSpaceChromeTabIds()).toEqual([t1.id, t3.id, t2.id]);
});
