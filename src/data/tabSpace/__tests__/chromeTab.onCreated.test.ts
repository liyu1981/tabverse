import {
  getTabSpaceChromeTabIds,
  setupMockChromeAnd2TabSpacesWithMonitoring,
  tabData1,
} from './common.test';

test('onCreated', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, tst1, d1, tst2, d2 } =
    await setupMockChromeAnd2TabSpacesWithMonitoring();

  const newt = mockChrome.insertTabFromData(tabData1, w1.id);
  await mockChrome.flushMessages();
  expect(getTabSpaceChromeTabIds(d1)).toEqual([t1.id, t2.id, t3.id, newt.id]);

  const oldSize = d1.tabSpace.tabs.size;
  const newt2 = mockChrome.insertTabFromData(tabData1, w2.id);
  await mockChrome.flushMessages();
  expect(d1.tabSpace.tabs.size).toEqual(oldSize);
  expect(getTabSpaceChromeTabIds(d2)).toEqual([t4.id, newt2.id]);
});
