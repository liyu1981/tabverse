import { setupMockChromeAnd2TabSpacesWithMonitoring } from './common.test';

test('normal', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, tst1, d1, tst2, d2 } =
    await setupMockChromeAnd2TabSpacesWithMonitoring();

  const tab2 = d1.tabSpace.findTabByChromeTabId(t2.id);
  mockChrome.removeTab(t2.id);
  await mockChrome.flushMessages();

  expect(d1.tabSpace.findTabByChromeTabId(t2.id)).toBeUndefined();
  expect(d1.tabSpace.tabIds.includes(tab2.id)).toBeFalsy();
});
