import { $tabSpace, tabSpaceStoreApi } from '../store';
import { initMockChrome, initNewTabSpaceData, tsTabData1 } from './common.test';

test('updateTabSpaceName', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4 } = initMockChrome();

  const tst1 = mockChrome.insertTabFromData(tsTabData1, w1.id, 0);
  await mockChrome.flushMessages();

  initNewTabSpaceData(tst1.id, tst1.windowId, true);
  tabSpaceStoreApi.updateTabSpace({ name: 'testName' });
  expect($tabSpace.getState().name).toEqual('testName');
});
