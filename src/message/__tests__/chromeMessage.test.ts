import { BackgroundMsg, TabSpaceMsg } from '../message';

test('dummy', () => {});

// test('TabSpaceMsg.Focus', async () => {
//   const { mockChrome, w1, w2, t1, t2, t3, t4, tst1, d1, tst2, d2 } =
//     await setupMockChromeAnd2TabSpacesWithMonitoring();

//   mockChrome.runtime.sendMessage({
//     type: TabSpaceMsg.Focus,
//     payload: tst2.id,
//   });
//   await mockChrome.flushMessages();
//   expect(mockChrome.currentWindowId).toEqual(tst2.windowId);
//   expect(mockChrome.getWindow().tabs.activeTabIndex).toEqual(tst2.position);
// });

// test('misc', async () => {
//   const { mockChrome, w1, w2, t1, t2, t3, t4, tst1, d1, tst2, d2 } =
//     await setupMockChromeAnd2TabSpacesWithMonitoring();

//   mockChrome.runtime.sendMessage({
//     type: 'not a message',
//     payload: 1,
//   });
//   await mockChrome.flushMessages();

//   mockChrome.runtime.sendMessage({
//     type: BackgroundMsg.AuditComplete,
//     payload: ['audit complete'],
//   });
//   await mockChrome.flushMessages();
// });
