import { $tabSpace, tabSpaceStoreApi } from '../store';
import {
  TABSPACE_MANAGER_TAB_TITLE_PREFIX,
  TABSPACE_MANAGER_TAB_URL_PREFIX,
} from '../../../global';
import { scanCurrentTabs, startMonitorTabChanges } from '../chromeTab';

import { getMockChrome } from '../../../dev/chromeMock';
import { startMonitorChromeMessage } from '../../../message/chromeMessage';

export const flushPromises = () => new Promise(setImmediate);

export function initMockChrome() {
  const mockChrome = getMockChrome();
  const w1 = mockChrome.addWindow();
  const w2 = mockChrome.addWindow();
  const t1 = mockChrome.insertTabFromData(tabData1, w1.id);
  const t2 = mockChrome.insertTabFromData(tabData2, w1.id);
  const t3 = mockChrome.insertTabFromData(tabData1, w1.id);
  const t4 = mockChrome.insertTabFromData(tabData2, w2.id);
  return { mockChrome, w1, w2, t1, t2, t3, t4 };
}

export function initNewTabSpaceData(
  chromeTabId?: number,
  chromeWindowId?: number,
  autoSetName = false,
) {
  if (chromeTabId && chromeWindowId) {
    tabSpaceStoreApi.updateTabSpace({ chromeTabId, chromeWindowId });
  }
  if (autoSetName) {
    tabSpaceStoreApi.setName(`Window-${chromeWindowId}`);
  }
}

export async function setupMockChromeAndTabSpaceWithMonitoring() {
  const { mockChrome, w1, w2, t1, t2, t3, t4 } = initMockChrome();
  const tst1 = mockChrome.insertTabFromData(tsTabData1, w1.id, 0);
  initNewTabSpaceData(tst1.id, tst1.windowId, true);
  await scanCurrentTabs();
  startMonitorTabChanges();
  startMonitorChromeMessage();
  return { mockChrome, w1, w2, t1, t2, t3, t4, tst1 };
}

export function getTabSpaceChromeTabIds() {
  return $tabSpace
    .getState()
    .tabs.map((tab) => tab.chromeTabId)
    .toArray();
}

export const tsTabData1 = {
  title: TABSPACE_MANAGER_TAB_TITLE_PREFIX,
  url: TABSPACE_MANAGER_TAB_URL_PREFIX,
  favIconUrl: '',
  pinned: false,
};

export const tabData1 = {
  title: 'new tab',
  url: 'https://www.test.com',
  favIconUrl: 'https://www.test.com/icon',
  pinned: false,
};

export const tabData2 = {
  title: 'new tab2',
  url: 'https://www.test.com/2',
  favIconUrl: 'https://www.test.com/icon',
  pinned: false,
};

export const tabData3 = {
  title: undefined,
  url: undefined,
  favIconUrl: undefined,
  pinned: false,
};

test('common', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, tst1 } =
    await setupMockChromeAndTabSpaceWithMonitoring();
  expect(getTabSpaceChromeTabIds()).toEqual([t1.id, t2.id, t3.id]);
});
