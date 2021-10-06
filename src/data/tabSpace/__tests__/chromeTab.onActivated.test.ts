import { setupMockChromeAnd2TabSpacesWithMonitoring } from './common.test';

// TODO: whether we have ways to validate this?
test('onActivated', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, tst1, d1, tst2, d2 } =
    await setupMockChromeAnd2TabSpacesWithMonitoring();

  mockChrome.setActiveTab(t2.id);
  await mockChrome.flushMessages();

  mockChrome.setActiveTab(d1.tabSpace.chromeTabId);
  await mockChrome.flushMessages();
});
