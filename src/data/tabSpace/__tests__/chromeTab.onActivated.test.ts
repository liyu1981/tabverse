import { setupMockChromeAndTabSpaceWithMonitoring } from './common.test';

// TODO: whether we have ways to validate this?
test('onActivated', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, tst1 } =
    await setupMockChromeAndTabSpaceWithMonitoring();

  mockChrome.setActiveTab(t2.id);
  await mockChrome.flushMessages();

  mockChrome.setActiveTab(tst1.id);
  await mockChrome.flushMessages();
});
