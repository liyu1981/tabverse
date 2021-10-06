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

test('tabSpaceAction move to new window', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, tst1, d1, tst2, d2 } =
    await setupMockChromeAnd2TabSpacesWithMonitoring();

  const tst2renewed = mockChrome.moveTabToNewWindow(tst2.id);
  await mockChrome.flushMessages();
  expect(d1.tabSpace.tabs.map((tab) => tab.chromeTabId).toArray()).toEqual([
    t1.id,
    t2.id,
    t3.id,
  ]);
  expect(getTabSpaceChromeTabIds(d2)).toEqual([]);
  expect(d2.tabSpace.chromeTabId).toEqual(tst2.id);
  expect(d2.tabSpace.chromeWindowId).toEqual(tst2renewed.windowId);
  expect(d1.tabSpaceRegistry.registry.size).toEqual(2);
  expect(d2.tabSpaceRegistry.registry.size).toEqual(2);
  expect(d1.tabSpaceRegistry.registry.get(d2.tabSpace.id)).toEqual(
    d2.tabSpace.toTabSpaceStub(),
  );
});
