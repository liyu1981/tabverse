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

test('basic', () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, t5, t6 } = initMockChrome();

  // console.log(JSON.stringify(mockChrome.toJSON()));
  expect(mockChrome.toJSON()).toEqual({
    currentWindowId: 1001,
    nextTabId: 106,
    nextWindowId: 1002,
    windows: [
      {
        id: 1001,
        tabs: {
          activeTabIndex: 0,
          tabs: [
            {
              id: 101,
              windowId: 1001,
              position: 0,
              title: 'Tabverse:Manager',
              url: 'chrome-extension://tabverse-jest-test/manager.html',
              favIconUrl: '',
              pinned: false,
            },
            {
              id: 102,
              windowId: 1001,
              position: 1,
              title: 'new tab',
              url: 'https://www.test.com',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
            {
              id: 103,
              windowId: 1001,
              position: 2,
              title: 'new tab2',
              url: 'https://www.test.com/2',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
            {
              id: 104,
              windowId: 1001,
              position: 3,
              title: 'new tab',
              url: 'https://www.test.com',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
          ],
        },
      },
      {
        id: 1002,
        tabs: {
          activeTabIndex: 0,
          tabs: [
            {
              id: 105,
              windowId: 1002,
              position: 0,
              title: 'Tabverse:Manager',
              url: 'chrome-extension://tabverse-jest-test/manager.html',
              favIconUrl: '',
              pinned: false,
            },
            {
              id: 106,
              windowId: 1002,
              position: 1,
              title: 'new tab2',
              url: 'https://www.test.com/2',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
          ],
        },
      },
    ],
  });
});

test('moveTab', () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, t5, t6 } = initMockChrome();

  mockChrome.moveTab(t4.id, 1);
  // console.log(JSON.stringify(mockChrome.toJSON()));
  expect(mockChrome.toJSON()).toEqual({
    currentWindowId: 1001,
    nextTabId: 106,
    nextWindowId: 1002,
    windows: [
      {
        id: 1001,
        tabs: {
          activeTabIndex: 0,
          tabs: [
            {
              id: 101,
              windowId: 1001,
              position: 0,
              title: 'Tabverse:Manager',
              url: 'chrome-extension://tabverse-jest-test/manager.html',
              favIconUrl: '',
              pinned: false,
            },
            {
              id: 104,
              windowId: 1001,
              position: 1,
              title: 'new tab',
              url: 'https://www.test.com',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
            {
              id: 102,
              windowId: 1001,
              position: 2,
              title: 'new tab',
              url: 'https://www.test.com',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
            {
              id: 103,
              windowId: 1001,
              position: 3,
              title: 'new tab2',
              url: 'https://www.test.com/2',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
          ],
        },
      },
      {
        id: 1002,
        tabs: {
          activeTabIndex: 0,
          tabs: [
            {
              id: 105,
              windowId: 1002,
              position: 0,
              title: 'Tabverse:Manager',
              url: 'chrome-extension://tabverse-jest-test/manager.html',
              favIconUrl: '',
              pinned: false,
            },
            {
              id: 106,
              windowId: 1002,
              position: 1,
              title: 'new tab2',
              url: 'https://www.test.com/2',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
          ],
        },
      },
    ],
  });

  mockChrome.moveTab(t4.id, 0);
  // console.log(JSON.stringify(mockChrome.toJSON()));
  expect(mockChrome.toJSON()).toEqual({
    currentWindowId: 1001,
    nextTabId: 106,
    nextWindowId: 1002,
    windows: [
      {
        id: 1001,
        tabs: {
          activeTabIndex: 1,
          tabs: [
            {
              id: 104,
              windowId: 1001,
              position: 0,
              title: 'new tab',
              url: 'https://www.test.com',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
            {
              id: 101,
              windowId: 1001,
              position: 1,
              title: 'Tabverse:Manager',
              url: 'chrome-extension://tabverse-jest-test/manager.html',
              favIconUrl: '',
              pinned: false,
            },
            {
              id: 102,
              windowId: 1001,
              position: 2,
              title: 'new tab',
              url: 'https://www.test.com',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
            {
              id: 103,
              windowId: 1001,
              position: 3,
              title: 'new tab2',
              url: 'https://www.test.com/2',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
          ],
        },
      },
      {
        id: 1002,
        tabs: {
          activeTabIndex: 0,
          tabs: [
            {
              id: 105,
              windowId: 1002,
              position: 0,
              title: 'Tabverse:Manager',
              url: 'chrome-extension://tabverse-jest-test/manager.html',
              favIconUrl: '',
              pinned: false,
            },
            {
              id: 106,
              windowId: 1002,
              position: 1,
              title: 'new tab2',
              url: 'https://www.test.com/2',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
          ],
        },
      },
    ],
  });
});

test('removeTab', () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, t5, t6 } = initMockChrome();
  mockChrome.removeTab(t3.id);
  // console.log(JSON.stringify(mockChrome.toJSON()));
  expect(mockChrome.toJSON()).toEqual({
    currentWindowId: 1001,
    nextTabId: 106,
    nextWindowId: 1002,
    windows: [
      {
        id: 1001,
        tabs: {
          activeTabIndex: 0,
          tabs: [
            {
              id: 101,
              windowId: 1001,
              position: 0,
              title: 'Tabverse:Manager',
              url: 'chrome-extension://tabverse-jest-test/manager.html',
              favIconUrl: '',
              pinned: false,
            },
            {
              id: 102,
              windowId: 1001,
              position: 1,
              title: 'new tab',
              url: 'https://www.test.com',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
            {
              id: 104,
              windowId: 1001,
              position: 2,
              title: 'new tab',
              url: 'https://www.test.com',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
          ],
        },
      },
      {
        id: 1002,
        tabs: {
          activeTabIndex: 0,
          tabs: [
            {
              id: 105,
              windowId: 1002,
              position: 0,
              title: 'Tabverse:Manager',
              url: 'chrome-extension://tabverse-jest-test/manager.html',
              favIconUrl: '',
              pinned: false,
            },
            {
              id: 106,
              windowId: 1002,
              position: 1,
              title: 'new tab2',
              url: 'https://www.test.com/2',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
          ],
        },
      },
    ],
  });

  mockChrome.removeTab(t1.id);
  // console.log(JSON.stringify(mockChrome.toJSON()));
  expect(mockChrome.toJSON()).toEqual({
    currentWindowId: 1001,
    nextTabId: 106,
    nextWindowId: 1002,
    windows: [
      {
        id: 1001,
        tabs: {
          activeTabIndex: 0,
          tabs: [
            {
              id: 102,
              windowId: 1001,
              position: 0,
              title: 'new tab',
              url: 'https://www.test.com',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
            {
              id: 104,
              windowId: 1001,
              position: 1,
              title: 'new tab',
              url: 'https://www.test.com',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
          ],
        },
      },
      {
        id: 1002,
        tabs: {
          activeTabIndex: 0,
          tabs: [
            {
              id: 105,
              windowId: 1002,
              position: 0,
              title: 'Tabverse:Manager',
              url: 'chrome-extension://tabverse-jest-test/manager.html',
              favIconUrl: '',
              pinned: false,
            },
            {
              id: 106,
              windowId: 1002,
              position: 1,
              title: 'new tab2',
              url: 'https://www.test.com/2',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
          ],
        },
      },
    ],
  });
});

test('updateTab', () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, t5, t6 } = initMockChrome();
  const t106 = mockChrome.getTab(106);
  const toTitle = `${t106.title} changed`;
  mockChrome.updateTab(106, { title: toTitle });
  expect(mockChrome.getTab(106).title).toEqual(toTitle);
});

test('setActiveTab', () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, t5, t6 } = initMockChrome();
  mockChrome.setActiveTab(t5.id);
  expect(mockChrome.getWindow(t5.windowId).tabs.activeTabIndex).toEqual(
    t5.position,
  );
});

test('moveTabToNewWindow', () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, t5, t6 } = initMockChrome();
  mockChrome.moveTabToWindow(t6.id, w1.id);
  // console.log(JSON.stringify(mockChrome.toJSON()));
  expect(mockChrome.toJSON()).toEqual({
    currentWindowId: 1001,
    nextTabId: 106,
    nextWindowId: 1002,
    windows: [
      {
        id: 1001,
        tabs: {
          activeTabIndex: 0,
          tabs: [
            {
              id: 101,
              windowId: 1001,
              position: 0,
              title: 'Tabverse:Manager',
              url: 'chrome-extension://tabverse-jest-test/manager.html',
              favIconUrl: '',
              pinned: false,
            },
            {
              id: 102,
              windowId: 1001,
              position: 1,
              title: 'new tab',
              url: 'https://www.test.com',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
            {
              id: 103,
              windowId: 1001,
              position: 2,
              title: 'new tab2',
              url: 'https://www.test.com/2',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
            {
              id: 104,
              windowId: 1001,
              position: 3,
              title: 'new tab',
              url: 'https://www.test.com',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
            {
              id: 106,
              windowId: 1001,
              position: 4,
              title: 'new tab2',
              url: 'https://www.test.com/2',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
          ],
        },
      },
      {
        id: 1002,
        tabs: {
          activeTabIndex: 0,
          tabs: [
            {
              id: 105,
              windowId: 1002,
              position: 0,
              title: 'Tabverse:Manager',
              url: 'chrome-extension://tabverse-jest-test/manager.html',
              favIconUrl: '',
              pinned: false,
            },
          ],
        },
      },
    ],
  });

  mockChrome.moveTabToNewWindow(t6.id);
  // console.log(JSON.stringify(mockChrome.toJSON()));
  expect(mockChrome.toJSON()).toEqual({
    currentWindowId: 1003,
    nextTabId: 106,
    nextWindowId: 1003,
    windows: [
      {
        id: 1001,
        tabs: {
          activeTabIndex: 0,
          tabs: [
            {
              id: 101,
              windowId: 1001,
              position: 0,
              title: 'Tabverse:Manager',
              url: 'chrome-extension://tabverse-jest-test/manager.html',
              favIconUrl: '',
              pinned: false,
            },
            {
              id: 102,
              windowId: 1001,
              position: 1,
              title: 'new tab',
              url: 'https://www.test.com',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
            {
              id: 103,
              windowId: 1001,
              position: 2,
              title: 'new tab2',
              url: 'https://www.test.com/2',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
            {
              id: 104,
              windowId: 1001,
              position: 3,
              title: 'new tab',
              url: 'https://www.test.com',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
          ],
        },
      },
      {
        id: 1002,
        tabs: {
          activeTabIndex: 0,
          tabs: [
            {
              id: 105,
              windowId: 1002,
              position: 0,
              title: 'Tabverse:Manager',
              url: 'chrome-extension://tabverse-jest-test/manager.html',
              favIconUrl: '',
              pinned: false,
            },
          ],
        },
      },
      {
        id: 1003,
        tabs: {
          activeTabIndex: 0,
          tabs: [
            {
              id: 106,
              windowId: 1003,
              position: 0,
              title: 'new tab2',
              url: 'https://www.test.com/2',
              favIconUrl: 'https://www.test.com/icon',
              pinned: false,
            },
          ],
        },
      },
    ],
  });
});

test('getTab getWindow', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, t5, t6 } = initMockChrome();
  expect(mockChrome.getTab(888)).toBeNull();
  const t = await mockChrome.tabs.get(888);
  expect(t).toBeNull();
  expect(mockChrome.getWindow().id).toEqual(w1.id);
});

test('tabs ops', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, t5, t6 } = initMockChrome();
  const t101 = await mockChrome.tabs.get(101);
  expect(t101).toEqual(t1);
  const w1tabs = await mockChrome.tabs.query({ currentWindow: true });
  expect(w1tabs).toEqual([t1, t2, t3, t4]);
  const w1ActiveTabs = await mockChrome.tabs.query({
    currentWindow: true,
    active: true,
  });
  expect(w1ActiveTabs).toEqual([t1]);
  const allTabs = await mockChrome.tabs.query({});
  expect(allTabs).toEqual([t1, t2, t3, t4, t5, t6]);
  const data = await mockChrome.tabs.captureVisibleTab(w2.id);
  expect(data).toEqual('data:1001.101');
  expect(mockChrome.replaceTabFromData(tabData1, 888)).toBeNull();
});
