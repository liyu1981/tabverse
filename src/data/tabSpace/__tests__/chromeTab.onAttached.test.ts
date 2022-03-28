import { $tabSpace } from '../store';
import { setupMockChromeAndTabSpaceWithMonitoring } from './common.test';

test('normalTabAction', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, tst1 } =
    await setupMockChromeAndTabSpaceWithMonitoring();

  mockChrome.moveTabToWindow(t4.id, w1.id);
  await mockChrome.flushMessages();
  expect(
    $tabSpace
      .getState()
      .tabs.map((tab) => tab.chromeTabId)
      .toArray(),
  ).toEqual([t1.id, t2.id, t3.id, t4.id]);
});
