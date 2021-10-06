import {
  tabData1,
  tabData2,
  tsTabData1,
} from '../../data/tabSpace/__tests__/common.test';

import { getMockChrome } from '../chromeMock';

function initMockChrome() {
  const mockChrome = getMockChrome();
  const w1 = mockChrome.addWindow();
  const w2 = mockChrome.addWindow();
  const t1 = mockChrome.insertTabFromData(tsTabData1, w1.id);
  const t2 = mockChrome.insertTabFromData(tabData1, w1.id);
  const t3 = mockChrome.insertTabFromData(tabData2, w1.id);
  const t4 = mockChrome.insertTabFromData(tabData1, w1.id);
  const t5 = mockChrome.insertTabFromData(tsTabData1, w2.id);
  const t6 = mockChrome.insertTabFromData(tabData2, w2.id);
  return { mockChrome, w1, w2, t1, t2, t3, t4, t5, t6 };
}

test('onActivatedCallback', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, t5, t6 } = initMockChrome();
  const onActivatedCallback = jest.fn();
  mockChrome.tabs.onActivated.addListener(onActivatedCallback);
  mockChrome.setActiveTab(t6.id);
  await mockChrome.flushMessages();
  expect(onActivatedCallback).toBeCalled();
  const args = onActivatedCallback.mock.calls.pop();
  expect(args).toEqual([{ tabId: t6.id, windowId: t6.windowId }]);
});

test('onCreatedCallback', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, t5, t6 } = initMockChrome();
  const onCreatedCallback = jest.fn();
  mockChrome.tabs.onCreated.addListener(onCreatedCallback);
  const t7 = mockChrome.insertTabFromData(tabData2, w2.id);
  await mockChrome.flushMessages();
  expect(onCreatedCallback).toBeCalled();
  const args = onCreatedCallback.mock.calls.pop();
  expect(args).toEqual([t7]);
});

test('onAttachedCallback, onDetachedCallback', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, t5, t6 } = initMockChrome();
  const onAttachedCallback = jest.fn();
  const onDetachedCallback = jest.fn();
  mockChrome.tabs.onAttached.addListener(onAttachedCallback);
  mockChrome.tabs.onDetached.addListener(onDetachedCallback);
  mockChrome.moveTabToWindow(t3.id, w2.id);
  await mockChrome.flushMessages();
  expect(onDetachedCallback).toBeCalled();
  let args = onDetachedCallback.mock.calls.pop();
  expect(args).toEqual([
    t3.id,
    {
      oldPosition: 2,
      oldWindowId: w1.id,
    },
  ]);
  expect(onAttachedCallback).toBeCalled();
  args = onAttachedCallback.mock.calls.pop();
  expect(args).toEqual([
    t3.id,
    {
      newPosition: 2,
      newWindowId: w2.id,
    },
  ]);
});

test('onRemovedCallback', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, t5, t6 } = initMockChrome();
  const onRemovedCallback = jest.fn();
  mockChrome.tabs.onRemoved.addListener(onRemovedCallback);
  mockChrome.removeTab(t2.id);
  await mockChrome.flushMessages();
  expect(onRemovedCallback).toBeCalled();
  const args = onRemovedCallback.mock.calls.pop();
  expect(args).toEqual([
    102,
    {
      isWindowClosing: false,
      windowId: 1001,
    },
  ]);
});

test('onReplacedCallback', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, t5, t6 } = initMockChrome();
  const onReplacedCallback = jest.fn();
  mockChrome.tabs.onReplaced.addListener(onReplacedCallback);
  mockChrome.replaceTabFromData(tabData2, t2.id);
  await mockChrome.flushMessages();
  expect(onReplacedCallback).toBeCalled();
  const args = onReplacedCallback.mock.calls.pop();
  expect(args).toEqual([107, t2.id]);
});

test('onUpdatedCallback', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, t5, t6 } = initMockChrome();
  const onUpdatedCallback = jest.fn();
  mockChrome.tabs.onUpdated.addListener(onUpdatedCallback);
  const toTitle = t2.title + 'changed';
  mockChrome.updateTab(t2.id, { title: toTitle });
  await mockChrome.flushMessages();
  expect(onUpdatedCallback).toBeCalled();
  const args = onUpdatedCallback.mock.calls.pop();
  expect(args).toEqual([
    102,
    {
      title: toTitle,
    },
  ]);
});

test('onMovedCallback', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, t5, t6 } = initMockChrome();
  const onMovedCallback = jest.fn();
  mockChrome.tabs.onMoved.addListener(onMovedCallback);
  const fromIndex = t2.position;
  const toIndex = t2.position + 1;
  mockChrome.moveTab(t2.id, toIndex);
  await mockChrome.flushMessages();
  expect(onMovedCallback).toBeCalled();
  const args = onMovedCallback.mock.calls.pop();
  expect(args).toEqual([102, { fromIndex, toIndex, windowId: t2.windowId }]);
});

test('onMessageCallback', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, t5, t6 } = initMockChrome();
  const onMessageCallback = jest.fn();
  mockChrome.runtime.onMessage.addListener(onMessageCallback);
  mockChrome.runtime.sendMessage({ type: 'test', payload: 'hello' });
  await mockChrome.flushMessages();
  expect(onMessageCallback).toBeCalled();
  const args = onMessageCallback.mock.calls.pop();
  expect(args).toEqual([
    { type: 'test', payload: 'hello' },
    { id: 'unknown' },
    mockChrome.runtime.defaultCallback,
  ]);
});

test('windowOnCreated', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, t5, t6 } = initMockChrome();
  const onCreatedCallback = jest.fn();
  mockChrome.windows.onCreated.addListener(onCreatedCallback);
  mockChrome.addWindow();
  await mockChrome.flushMessages();
  expect(onCreatedCallback).toBeCalled();
  const args = onCreatedCallback.mock.calls.pop();
  expect(args).toEqual([
    {
      id: 1003,
      tabs: {
        activeTabIndex: 0,
        tabs: [],
      },
    },
    undefined,
  ]);
});

test('windowOnRemoved', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, t5, t6 } = initMockChrome();
  const onRemovedCallback = jest.fn();
  mockChrome.windows.onRemoved.addListener(onRemovedCallback);
  const mockWindow = mockChrome.addWindow();
  mockChrome.removeWindow(mockWindow.id);
  await mockChrome.flushMessages();
  expect(onRemovedCallback).toBeCalled();
  const args = onRemovedCallback.mock.calls.pop();
  expect(args).toEqual([1003, undefined]);
});
