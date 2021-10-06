import {
  getTabSpaceChromeTabIds,
  setupMockChromeAnd2TabSpacesWithMonitoring,
} from './common.test';

test('onCreated', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, tst1, d1, tst2, d2 } =
    await setupMockChromeAnd2TabSpacesWithMonitoring();

  mockChrome.moveTab(t2.id, 3);
  await mockChrome.flushMessages();
  expect(getTabSpaceChromeTabIds(d1)).toEqual([t1.id, t3.id, t2.id]);
});
