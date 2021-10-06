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

test('tabSpaceAction', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, tst1, d1, tst2, d2 } =
    await setupMockChromeAnd2TabSpacesWithMonitoring();
  const oldId = tst1.id;
  mockChrome.reloadTab(tst1.id);
  await mockChrome.flushMessages();
  expect(d1.tabSpace.id).not.toEqual(oldId);
  expect(d2.tabSpaceRegistry.registry.size).toEqual(1);
});
