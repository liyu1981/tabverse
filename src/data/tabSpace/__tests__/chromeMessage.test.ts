import {
  BackgroundMsg,
  TabSpaceMsg,
  TabSpaceRegistryMsg,
} from '../../../message';

import { setupMockChromeAnd2TabSpacesWithMonitoring } from './common.test';

test('TabSpaceMsg.Focus', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, tst1, d1, tst2, d2 } =
    await setupMockChromeAnd2TabSpacesWithMonitoring();

  mockChrome.runtime.sendMessage({
    type: TabSpaceMsg.Focus,
    payload: tst2.id,
  });
  await mockChrome.flushMessages();
  expect(mockChrome.currentWindowId).toEqual(tst2.windowId);
  expect(mockChrome.getWindow().tabs.activeTabIndex).toEqual(tst2.position);
});

test('TabSpaceRegistryMsg.RemoveTabSpace', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, tst1, d1, tst2, d2 } =
    await setupMockChromeAnd2TabSpacesWithMonitoring();

  mockChrome.runtime.sendMessage({
    type: TabSpaceRegistryMsg.RemoveTabSpace,
    payload: d2.tabSpace.id,
  });
  await mockChrome.flushMessages();
  expect(d1.tabSpaceRegistry.registry.size).toEqual(1);
  expect(d1.tabSpaceRegistry.registry.get(d2.tabSpace.id)).toBeUndefined();
});

test('misc', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, tst1, d1, tst2, d2 } =
    await setupMockChromeAnd2TabSpacesWithMonitoring();

  mockChrome.runtime.sendMessage({
    type: 'not a message',
    payload: 1,
  });
  await mockChrome.flushMessages();

  mockChrome.runtime.sendMessage({
    type: BackgroundMsg.AuditComplete,
    payload: ['audit complete'],
  });
  await mockChrome.flushMessages();
});
