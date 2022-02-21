import {
  getTabSpaceChromeTabIds,
  setupMockChromeAnd2TabSpacesWithMonitoring,
} from './common.test';

test('normalTabAction', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, tst1, d1, tst2, d2 } =
    await setupMockChromeAnd2TabSpacesWithMonitoring();

  mockChrome.moveTabToWindow(t4.id, w1.id);
  await mockChrome.flushMessages();
  expect(d1.tabSpace.tabs.map((tab) => tab.chromeTabId).toArray()).toEqual([
    t1.id,
    t2.id,
    t3.id,
    t4.id,
  ]);
  expect(getTabSpaceChromeTabIds(d2)).toEqual([]);
});
