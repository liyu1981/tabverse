import { isTabSpaceManagerPage, logger } from '../../global';

import { ITabSpaceData } from './bootstrap';
import { Tab } from './Tab';
import { TabPreview } from './TabPreview';
import { TabSpace } from './TabSpace';
import { getUnsavedNewId } from '../common';
import { isJestTest } from '../../debug';
import {
  getTabSpaceRegistry,
  removeTabSpace as tabSpaceRegistryRemoveTabSpace,
  updateTabSpace as tabSpaceRegistryUpdateTabSpace,
} from '../../tabSpaceRegistry';

export async function scanCurrentTabs(tabSpaceData: ITabSpaceData) {
  const { tabSpace } = tabSpaceData;
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const newTabs: Tab[] = [];
  tabs.forEach((tab) => {
    if (isTabSpaceManagerPage(tab)) {
      return;
    }
    if (tabSpace.findTabByChromeTabId(tab.id)) {
      return;
    }
    const t = Tab.fromILiveTab({
      chromeTabId: tab.id,
      chromeWindowId: tab.windowId,
    });
    copyChromeTabFields(t, tab);
    newTabs.push(t);
  });
  tabSpace.addTabs(newTabs);
}

function inCurrentTabSpace(windowId: number, tabSpace: TabSpace) {
  return windowId === tabSpace.chromeWindowId;
}

function copyChromeTabFields(
  t: Tab,
  tab: chrome.tabs.Tab | chrome.tabs.TabChangeInfo,
): boolean {
  let changed = false;
  if (tab.title && t.title !== tab.title) {
    t.title = tab.title.substr(0);
    changed = true;
  }
  if (tab.url && t.url !== tab.url) {
    t.url = tab.url;
    changed = true;
  }
  if (tab.favIconUrl && t.favIconUrl !== tab.favIconUrl) {
    t.favIconUrl = tab.favIconUrl;
    changed = true;
  }
  if (tab.pinned && t.pinned !== tab.pinned) {
    t.pinned = tab.pinned;
    changed = true;
  }
  return changed;
}

function doCapturePreview(
  tabPreview: TabPreview,
  tabId: number,
  windowId: number,
) {
  // @ts-ignore
  if (isJestTest() && chrome.mocked) {
    // in our mock testing, the chrome is mockChrome which will have
    // .mocked=true
    return;
  }
  // chrome.tabs.captureVisibleTab is currently working as by taking windowId
  // instead of tabId, which in implementation will only try to capture the
  // screen after chrome.tabs are idling, which again is very hard to estimate.
  // So when calling it, we may face the exception like 'Tab is busy or in
  // moving' and have to retry. So here we use wait 200ms and retry max 5 times.
  // But this method is still not perfect: an edge case is after we issue the
  // API call, user may switch between tabs and we will end up with capturing
  // the wrong tab (and this is mostly happening with restore tabspace tabs.)
  const wait = 200;
  let maxRetry = 5;
  const capturePreview = () => {
    maxRetry -= 1;
    async function action() {
      logger.log('request tab visible tab (tabId, windowId):', tabId, windowId);
      try {
        const dataurl = await chrome.tabs.captureVisibleTab(windowId, {
          quality: 85,
        });
        // console.log('got back dataurl:', dataurl.length, activeInfo.tabId);
        // it is possible that when we get the dataurl, the tab has been
        // switched (as captureVisibleTab is operating towards windowId), so
        // here query chrome tabs for the current active one so that we know
        // whether we have got the correct screenshot. (Must not use
        // chrome.tabs.getCurrent as it will always return the tab this script
        // running in, which is tabspace manager tab)
        const tabs = await chrome.tabs.query({
          active: true,
          // pay attention to use currentWindow here, as if not use, can result
          // in query other window active
          currentWindow: true,
        });
        if (tabs.length >= 1 && tabs[0].id === tabId) {
          logger.log(
            'current tab matched requested, will save preview',
            tabs[0].id,
            tabId,
          );
          tabPreview.setPreview(tabId, dataurl);
        } else {
          logger.log(
            'current tab not matched requested, will skip save preview',
            tabs[0].id,
            tabId,
          );
        }
      } catch (e) {
        if (maxRetry > 0) {
          setTimeout(capturePreview, wait);
        }
      }
    }
    action();
  };
  setTimeout(capturePreview, wait);
}

async function maintainTabOrder(tabSpace: TabSpace) {
  const tabs = await chrome.tabs.query({ windowId: tabSpace.chromeWindowId });
  const sortedTabs: Tab[] = [];
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    const t = tabSpace.findTabByChromeTabId(tab.id);
    if (t) {
      sortedTabs.push(t);
    }
  }
  tabSpace.replaceTabs(sortedTabs);
}

export function updateTabSpaceName(tabSpace: TabSpace, newName: string) {
  tabSpaceRegistryUpdateTabSpace({
    from: tabSpace.id,
    to: tabSpace.id,
    entry: tabSpace.toTabSpaceStub(),
  });
}

export function onChromeTabAttached(tabSpaceData: ITabSpaceData) {
  const { tabSpace, tabPreview } = tabSpaceData;
  async function tabSpaceAction(
    chromeTabId: number,
    attachInfo: chrome.tabs.TabAttachInfo,
  ) {
    const chromeTab = await chrome.tabs.get(chromeTabId);
    const oldId = tabSpace.id;
    tabSpace.reset(chromeTab.id, chromeTab.windowId, getUnsavedNewId());
    await scanCurrentTabs(tabSpaceData);

    tabSpaceRegistryUpdateTabSpace({
      from: oldId,
      to: tabSpace.id,
      entry: tabSpace.toTabSpaceStub(),
    });

    doCapturePreview(tabPreview, chromeTabId, chromeTab.windowId);
  }

  async function normalTabAction(
    tabId: number,
    attachInfo: chrome.tabs.TabAttachInfo,
  ) {
    const tab = await chrome.tabs.get(tabId);
    if (isTabSpaceManagerPage(tab)) {
      // a tabspace manager page attached to this window
      // we will either reset or reload this page
    } else {
      const t = Tab.fromILiveTab({
        chromeTabId: tab.id,
        chromeWindowId: tab.windowId,
      });
      t.tabSpaceId = tabSpace.id;
      copyChromeTabFields(t, tab);
      tabSpace.addTab(t);
      await maintainTabOrder(tabSpace);
    }
  }

  return (tabId: number, attachInfo: chrome.tabs.TabAttachInfo) => {
    logger.log('chrome attached tab:', tabId, attachInfo);
    if (tabId === tabSpace.chromeTabId) {
      tabSpaceAction(tabId, attachInfo);
      return;
    }
    if (!inCurrentTabSpace(attachInfo.newWindowId, tabSpace)) {
      return;
    }
    normalTabAction(tabId, attachInfo);
  };
}

export function onChromeTabCreated(tabSpaceData: ITabSpaceData) {
  const { tabSpace } = tabSpaceData;
  async function normalTabAction(tab: chrome.tabs.Tab) {
    const t = Tab.fromILiveTab({
      chromeTabId: tab.id,
      chromeWindowId: tab.windowId,
    });
    copyChromeTabFields(t, tab);
    tabSpace.addTab(t);
    await maintainTabOrder(tabSpace);
  }
  return (tab: chrome.tabs.Tab) => {
    if (!inCurrentTabSpace(tab.windowId, tabSpace)) {
      return;
    }
    normalTabAction(tab);
  };
}

export function onChromeTabDetached(tabSpaceData: ITabSpaceData) {
  const { tabSpace, tabPreview } = tabSpaceData;

  function normalTabAction(
    tabId: number,
    detachInfo: chrome.tabs.TabDetachInfo,
  ) {
    tabSpace.removeTabByChromeTabId(tabId);
    tabPreview.removePreview(tabId);
  }

  return (tabId: number, detachInfo: chrome.tabs.TabDetachInfo) => {
    logger.log('chrome detached tab:', tabId, detachInfo);
    if (
      tabId === tabSpace.chromeTabId &&
      detachInfo.oldWindowId === tabSpace.chromeWindowId
    ) {
      // in fact we do not need to do anything when tabspace is detached as it
      // will be followed by another attach event, so we deal with the change
      // over there.
      return;
    }
    if (!inCurrentTabSpace(detachInfo.oldWindowId, tabSpace)) {
      return;
    }
    normalTabAction(tabId, detachInfo);
  };
}

export function onChromeTabRemoved(tabSpaceData: ITabSpaceData) {
  const { tabSpace, tabPreview } = tabSpaceData;

  const tabSpaceAction = (
    chromeTabId: number,
    removeInfo: chrome.tabs.TabRemoveInfo,
  ) => {
    tabSpaceRegistryRemoveTabSpace(chromeTabId);
  };

  const normalTabAction = (
    tabId: number,
    removeInfo: chrome.tabs.TabRemoveInfo,
  ) => {
    tabSpace.removeTabByChromeTabId(tabId);
    tabPreview.removePreview(tabId);
  };

  return (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => {
    logger.log('chrome tab removed:', tabId, removeInfo);
    if (getTabSpaceRegistry().findTabIdByChromeTabId(tabId)) {
      // closing a window with tabspace manager need to process it specially
      tabSpaceAction(tabId, removeInfo);
      return;
    }
    if (
      removeInfo.isWindowClosing ||
      !inCurrentTabSpace(removeInfo.windowId, tabSpace)
    ) {
      return;
    }
    normalTabAction(tabId, removeInfo);
  };
}

function onChromeTabReplaced(tabSpaceData: ITabSpaceData) {
  const { tabSpace } = tabSpaceData;

  async function normalTabAction(addedTabId: number, removedTabId: number) {
    const addedTab = await chrome.tabs.get(addedTabId);
    if (!inCurrentTabSpace(addedTab.windowId, tabSpace)) {
      return;
    }

    const oldT = tabSpace.findTabByChromeTabId(removedTabId);
    const newT = Tab.fromILiveTab({
      chromeTabId: addedTab.id,
      chromeWindowId: addedTab.windowId,
    });
    copyChromeTabFields(newT, addedTab);
    if (oldT) {
      tabSpace.replaceTab(oldT.id, newT.id, newT);
    } else {
      tabSpace.addTab(newT);
      await maintainTabOrder(tabSpace);
    }
  }

  return (addedTabId: number, removedTabId: number) => {
    normalTabAction(addedTabId, removedTabId);
  };
}

function onChromeTabUpdated(tabSpaceData: ITabSpaceData) {
  const { tabSpace, tabPreview } = tabSpaceData;

  async function tabSpaceAction(
    tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
  ) {
    if (tabSpace.chromeTabId === tabId) {
      // self page refresh will clear tabSpaceRegistry, but history.pushstate
      // will want to keep tabSpaceRegistry. So here we do nothing if it is
      // current tabSpace.
    } else {
      tabSpaceRegistryRemoveTabSpace(tabId);
    }
  }

  async function normalTabAction(
    tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
  ) {
    const tab = await chrome.tabs.get(tabId);
    if (!inCurrentTabSpace(tab.windowId, tabSpace)) {
      return;
    }
    const oldT = tabSpace.findTabByChromeTabId(tabId);
    if (oldT) {
      const newT = oldT.clone();
      const changed = copyChromeTabFields(newT, changeInfo);
      if (changed) {
        tabSpace.updateTab(newT);
      }
    }
    if (tab.active) {
      doCapturePreview(tabPreview, tabId, tab.windowId);
    }
  }

  return (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
    logger.log('chrome tab updated:', tabId, changeInfo);
    if (
      getTabSpaceRegistry().findTabIdByChromeTabId(tabId) &&
      changeInfo.status === 'loading'
    ) {
      // This is when one of our tabspace manager tab is reloaded
      tabSpaceAction(tabId, changeInfo);
      return;
    }
    normalTabAction(tabId, changeInfo);
  };
}

function onChromeTabMoved(tabSpaceData: ITabSpaceData) {
  const { tabSpace } = tabSpaceData;
  async function normalTabAction(
    tabId: number,
    moveInfo: chrome.tabs.TabMoveInfo,
  ) {
    await maintainTabOrder(tabSpace);
  }

  return (tabId: number, moveInfo: chrome.tabs.TabMoveInfo) => {
    logger.log('chrome tab moved: ', tabId, moveInfo);
    if (!inCurrentTabSpace(moveInfo.windowId, tabSpace)) {
      return;
    }
    normalTabAction(tabId, moveInfo);
  };
}

function onChromeTabActivated(tabSpaceData: ITabSpaceData) {
  const { tabSpace, tabPreview } = tabSpaceData;
  async function normalTabAction(activeInfo: chrome.tabs.TabActiveInfo) {
    doCapturePreview(tabPreview, activeInfo.tabId, activeInfo.windowId);
  }

  return (activeInfo: chrome.tabs.TabActiveInfo) => {
    logger.log('chrome tab activated:', activeInfo);
    if (!inCurrentTabSpace(activeInfo.windowId, tabSpace)) {
      return;
    }
    if (activeInfo.tabId === tabSpace.chromeTabId) {
      // do nothing when active tabspace manager tab
      return;
    }
    normalTabAction(activeInfo);
  };
}

export function startMonitorTabChanges(tabSpaceData: ITabSpaceData) {
  chrome.tabs.onAttached.addListener(onChromeTabAttached(tabSpaceData));
  chrome.tabs.onCreated.addListener(onChromeTabCreated(tabSpaceData));
  chrome.tabs.onDetached.addListener(onChromeTabDetached(tabSpaceData));
  chrome.tabs.onRemoved.addListener(onChromeTabRemoved(tabSpaceData));
  chrome.tabs.onReplaced.addListener(onChromeTabReplaced(tabSpaceData));
  chrome.tabs.onUpdated.addListener(onChromeTabUpdated(tabSpaceData));
  chrome.tabs.onMoved.addListener(onChromeTabMoved(tabSpaceData));
  chrome.tabs.onActivated.addListener(onChromeTabActivated(tabSpaceData));
}
