import {
  TABSPACE_MANAGER_TAB_TITLE_PREFIX,
  TABSPACE_MANAGER_TAB_URL_PREFIX,
} from '../../../global';
import { scanCurrentTabs, startMonitorTabChanges } from '../chromeTab';

import { ITabSpaceData } from '../bootstrap';
import { SavedTabSpaceCollection } from '../SavedTabSpaceCollection';
import { SavedTabSpaceStore } from '../SavedTabSpaceStore';
import { TabPreview } from '../TabPreview';
import { TabSpace } from '../TabSpace';
import { initMockChrome } from './chromeTab.scanCurrentTabs.test';
import { startMonitorChromeMessage } from '../chromeMessage';

export const flushPromises = () => new Promise(setImmediate);

export function createNewTabSpaceData(
  tabId?: number,
  windowId?: number,
  autoSetName = false,
) {
  const d = {
    tabSpace: new TabSpace(),
    tabPreview: new TabPreview(),
    savedTabSpaceStore: new SavedTabSpaceStore(),
    savedTabSpaceCollection: new SavedTabSpaceCollection(),
  };
  if (tabId && windowId) {
    d.tabSpace.setChromeTabAndWindowId(tabId, windowId, autoSetName);
  }
  return d;
}

export async function setupMockChromeAndTabSpaceWithMonitoring() {
  const { mockChrome, w1, w2, t1, t2, t3, t4 } = initMockChrome();
  const tst1 = mockChrome.insertTabFromData(tsTabData1, w1.id, 0);
  const d1 = createNewTabSpaceData(tst1.id, tst1.windowId, true);
  await scanCurrentTabs(d1);
  return { mockChrome, w1, w2, t1, t2, t3, t4, tst1, d1 };
}

export async function setupMockChromeAnd2TabSpacesWithMonitoring() {
  const { mockChrome, w1, w2, t1, t2, t3, t4, tst1, d1 } =
    await setupMockChromeAndTabSpaceWithMonitoring();
  startMonitorTabChanges(d1);

  const tst2 = mockChrome.insertTabFromData(tsTabData1, w2.id, 0, false);
  const d2 = createNewTabSpaceData(tst2.id, tst2.windowId, true);
  mockChrome.setCurrentWindow(w2.id);
  await scanCurrentTabs(d2);
  startMonitorTabChanges(d2);

  startMonitorChromeMessage();
  await mockChrome.flushMessages();

  return { mockChrome, w1, w2, t1, t2, t3, t4, tst1, d1, tst2, d2 };
}

export function getTabSpaceChromeTabIds(data: ITabSpaceData) {
  return data.tabSpace.tabs.map((tab) => tab.chromeTabId).toArray();
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
  const { mockChrome, w1, w2, t1, t2, t3, t4, tst1, d1, tst2, d2 } =
    await setupMockChromeAnd2TabSpacesWithMonitoring();
  expect(d1.tabSpace.tabs.map((tab) => tab.chromeTabId).toArray()).toEqual([
    t1.id,
    t2.id,
    t3.id,
  ]);
  expect(d1.tabSpace.tabIds).toEqual(d1.tabSpace.tabIds);
  expect(d2.tabSpace.tabs.map((tab) => tab.chromeTabId).toArray()).toEqual([
    t4.id,
  ]);
  expect(d2.tabSpace.tabIds).toEqual(d2.tabSpace.tabIds);
});
