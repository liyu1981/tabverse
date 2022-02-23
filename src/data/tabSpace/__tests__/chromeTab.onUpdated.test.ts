import {
  getTabSpaceChromeTabIds,
  setupMockChromeAnd2TabSpacesWithMonitoring,
} from './common.test';

test('normal', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, tst1, d1, tst2, d2 } =
    await setupMockChromeAnd2TabSpacesWithMonitoring();

  mockChrome.setActiveTab(t2.id);
  const changedTitle = t2.title + 'changed';
  mockChrome.updateTab(t2.id, { title: changedTitle });
  await mockChrome.flushMessages();
  expect(getTabSpaceChromeTabIds(d1)).toEqual([t1.id, t2.id, t3.id]);
  expect(d1.tabSpace.findTabByChromeTabId(t2.id).title).toEqual(changedTitle);
});
