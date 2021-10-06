import {
  getTabSpaceChromeTabIds,
  setupMockChromeAnd2TabSpacesWithMonitoring,
  tabData1,
} from './common.test';

test('normal', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, tst1, d1, tst2, d2 } =
    await setupMockChromeAnd2TabSpacesWithMonitoring();

  const newt = mockChrome.replaceTabFromData(tabData1, t2.id);
  await mockChrome.flushMessages();
  expect(getTabSpaceChromeTabIds(d1)).toEqual([t1.id, newt.id, t3.id]);
  expect(d1.tabSpace.findTabById(d1.tabSpace.tabIds[t2.position]).url).toEqual(
    tabData1.url,
  );
});
