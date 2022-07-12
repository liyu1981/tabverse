import { $tabSpace, tabSpaceStoreApi } from './store';
import { Tab, fromLiveTab, setTabSpaceId } from './Tab';
import { TabSpace, findTabByChromeTabId, toTabSpaceStub } from './TabSpace';
import { debounce, isTabSpaceManagerPage, logger } from '../../global';
import {
  removeTabSpace as tabSpaceRegistryRemoveTabSpace,
  updateTabSpace as tabSpaceRegistryUpdateTabSpace,
} from '../tabSpaceRegistry';

import { eq } from 'lodash';
import { findTabSpaceIdByChromeTabId } from '../tabSpaceRegistry/TabSpaceRegistry';
import { getStateTabSpaceRegistry } from '../tabSpaceRegistry/store';
import { getUnsavedNewId } from '../common';
import { isJestTest } from '../../debug';
import { produce } from 'immer';
import { saveCurrentTabSpaceIfNeeded } from './util';

const CHROME_TAB_DEBOUNCE_TIME = 500;

function inCurrentTabSpace(windowId: number, tabSpace: TabSpace) {
  return windowId === tabSpace.chromeWindowId;
}

function copyChromeTabFields(chromeTab: chrome.tabs.Tab, targetTab: Tab): Tab {
  return produce(targetTab, (draft) => {
    // console.log(
    //   'debug: before copyChromeTabFields:',
    //   targetTab.id,
    //   draft.title,
    //   draft.url,
    //   draft.favIconUrl,
    //   draft.pinned,
    //   draft.suspended,
    // );
    if (chromeTab.title) {
      draft.title = chromeTab.title;
    }
    if (chromeTab.url) {
      draft.url = chromeTab.url;
    }
    if (chromeTab.favIconUrl) {
      draft.favIconUrl = chromeTab.favIconUrl;
    }
    if (chromeTab.pinned) {
      draft.pinned = chromeTab.pinned;
    }
    if (chromeTab.discarded) {
      draft.suspended = chromeTab.discarded;
    }
    // console.log(
    //   'debug: after copyChromeTabFields:',
    //   targetTab.id,
    //   draft.title,
    //   draft.url,
    //   draft.favIconUrl,
    //   draft.pinned,
    //   draft.suspended,
    // );
  });
}

export async function scanCurrentTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const newTabs: Tab[] = [];
  const tabSpace = $tabSpace.getState();
  tabs.forEach((tab) => {
    if (isTabSpaceManagerPage(tab)) {
      return;
    }
    if (findTabByChromeTabId(tab.id, tabSpace)) {
      return;
    }
    let t = fromLiveTab({
      chromeTabId: tab.id,
      chromeWindowId: tab.windowId,
    });
    t = copyChromeTabFields(tab, t);
    newTabs.push(t);
  });
  tabSpaceStoreApi.addTabs(newTabs);
}

function doCapturePreview(chromeTabId: number, chromeWindowId: number) {
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
      logger.log(
        'request tab visible tab (tabId, windowId):',
        chromeTabId,
        chromeWindowId,
      );
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(chromeWindowId, {
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
        if (tabs.length >= 1 && tabs[0].id === chromeTabId) {
          logger.log(
            'current tab matched requested, will save preview',
            tabs[0].id,
            chromeTabId,
          );
          tabSpaceStoreApi.setPreview({
            chromeTabId: chromeTabId,
            preview: dataUrl,
          });
        } else {
          logger.log(
            'current tab not matched requested, will skip save preview',
            tabs[0].id,
            chromeTabId,
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

async function maintainTabOrder() {
  const currentTabSpace = $tabSpace.getState();
  const tabs = await chrome.tabs.query({
    windowId: currentTabSpace.chromeWindowId,
  });
  const sortedTabs: Tab[] = [];
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    const t = findTabByChromeTabId(tab.id, currentTabSpace);
    if (t) {
      sortedTabs.push(t);
    }
  }
  tabSpaceStoreApi.replaceAllTabs(sortedTabs);
}

export function updateTabSpaceName(newName: string) {
  tabSpaceStoreApi.setName(newName);
  const currentTabSpace = $tabSpace.getState();
  tabSpaceRegistryUpdateTabSpace({
    from: currentTabSpace.id,
    to: currentTabSpace.id,
    entry: toTabSpaceStub(currentTabSpace),
  });
  saveCurrentTabSpaceIfNeeded();
}

export function getOnChromeTabAttached() {
  async function tabSpaceAction(
    chromeTabId: number,
    _attachInfo: chrome.tabs.TabAttachInfo,
  ) {
    const chromeTab = await chrome.tabs.get(chromeTabId);
    const oldId = $tabSpace.getState().id;
    tabSpaceStoreApi.reset({
      chromeTabId: chromeTab.id,
      chromeWindowId: chromeTab.windowId,
      newId: getUnsavedNewId(),
    });
    await scanCurrentTabs();
    saveCurrentTabSpaceIfNeeded();

    tabSpaceRegistryUpdateTabSpace({
      from: oldId,
      to: $tabSpace.getState().id,
      entry: toTabSpaceStub($tabSpace.getState()),
    });

    doCapturePreview(chromeTabId, chromeTab.windowId);
  }

  async function normalTabAction(
    tabId: number,
    _attachInfo: chrome.tabs.TabAttachInfo,
  ) {
    const chromeTab = await chrome.tabs.get(tabId);
    if (isTabSpaceManagerPage(chromeTab)) {
      // a tabspace manager page attached to this window
      // we will either reset or reload this page
    } else {
      let t = fromLiveTab({
        chromeTabId: chromeTab.id,
        chromeWindowId: chromeTab.windowId,
      });
      t = setTabSpaceId($tabSpace.getState().id, t);
      t = copyChromeTabFields(chromeTab, t);
      tabSpaceStoreApi.addTab(t);
      await maintainTabOrder();
      saveCurrentTabSpaceIfNeeded();
    }
  }

  return (chromeTabId: number, attachInfo: chrome.tabs.TabAttachInfo) => {
    logger.log('chrome attached tab:', chromeTabId, attachInfo);
    if (chromeTabId === $tabSpace.getState().chromeTabId) {
      tabSpaceAction(chromeTabId, attachInfo);
      return;
    }
    if (!inCurrentTabSpace(attachInfo.newWindowId, $tabSpace.getState())) {
      return;
    }
    normalTabAction(chromeTabId, attachInfo);
  };
}

export function getOnChromeTabCreated() {
  async function normalTabAction(chromeTab: chrome.tabs.Tab) {
    let t = fromLiveTab({
      chromeTabId: chromeTab.id,
      chromeWindowId: chromeTab.windowId,
    });
    t = copyChromeTabFields(chromeTab, t);
    tabSpaceStoreApi.addTab(t);
    await maintainTabOrder();
    saveCurrentTabSpaceIfNeeded();
  }
  return (chromeTab: chrome.tabs.Tab) => {
    if (!inCurrentTabSpace(chromeTab.windowId, $tabSpace.getState())) {
      return;
    }
    normalTabAction(chromeTab);
  };
}

export function getOnChromeTabDetached() {
  function normalTabAction(
    chromeTabId: number,
    _detachInfo: chrome.tabs.TabDetachInfo,
  ) {
    tabSpaceStoreApi.removeTabByChromeTabId(chromeTabId);
    tabSpaceStoreApi.removePreview(chromeTabId);
    saveCurrentTabSpaceIfNeeded();
  }

  return (chromeTabId: number, detachInfo: chrome.tabs.TabDetachInfo) => {
    logger.log('chrome detached tab:', chromeTabId, detachInfo);
    if (
      chromeTabId === $tabSpace.getState().chromeTabId &&
      detachInfo.oldWindowId === $tabSpace.getState().chromeWindowId
    ) {
      // in fact we do not need to do anything when tabspace is detached as it
      // will be followed by another attach event, so we deal with the change
      // over there.
      return;
    }
    if (!inCurrentTabSpace(detachInfo.oldWindowId, $tabSpace.getState())) {
      return;
    }
    normalTabAction(chromeTabId, detachInfo);
  };
}

export function getOnChromeTabRemoved() {
  const tabSpaceAction = (
    chromeTabId: number,
    _removeInfo: chrome.tabs.TabRemoveInfo,
  ) => {
    tabSpaceRegistryRemoveTabSpace(chromeTabId);
  };

  const normalTabAction = (
    chromeTabId: number,
    _removeInfo: chrome.tabs.TabRemoveInfo,
  ) => {
    tabSpaceStoreApi.removeTabByChromeTabId(chromeTabId);
    tabSpaceStoreApi.removePreview(chromeTabId);
    saveCurrentTabSpaceIfNeeded();
  };

  return (chromeTabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => {
    logger.log('chrome tab removed:', chromeTabId, removeInfo);
    if (findTabSpaceIdByChromeTabId(chromeTabId, getStateTabSpaceRegistry())) {
      // closing a window with tabspace manager need to process it specially
      tabSpaceAction(chromeTabId, removeInfo);
      return;
    }
    if (
      removeInfo.isWindowClosing ||
      !inCurrentTabSpace(removeInfo.windowId, $tabSpace.getState())
    ) {
      return;
    }
    normalTabAction(chromeTabId, removeInfo);
  };
}

function getOnChromeTabReplaced() {
  async function normalTabAction(
    addedChromeTabId: number,
    removedChromeTabId: number,
  ) {
    const addedChromeTab = await chrome.tabs.get(addedChromeTabId);
    if (!inCurrentTabSpace(addedChromeTab.windowId, $tabSpace.getState())) {
      return;
    }

    const oldT = findTabByChromeTabId(removedChromeTabId, $tabSpace.getState());
    let newT = fromLiveTab({
      chromeTabId: addedChromeTab.id,
      chromeWindowId: addedChromeTab.windowId,
    });
    newT = copyChromeTabFields(addedChromeTab, newT);
    if (oldT) {
      tabSpaceStoreApi.replaceTab({ tid: oldT.id, tab: newT });
    } else {
      tabSpaceStoreApi.addTab(newT);
      await maintainTabOrder();
      saveCurrentTabSpaceIfNeeded();
    }
  }

  return (addedChromeTabId: number, removedTabId: number) => {
    normalTabAction(addedChromeTabId, removedTabId);
  };
}

function getOnChromeTabUpdated() {
  async function tabSpaceAction(
    chromeTabId: number,
    _changeInfo: chrome.tabs.TabChangeInfo,
  ) {
    if (chromeTabId === $tabSpace.getState().chromeTabId) {
      // do not do anything when this tabSpace tab is updating
    } else {
      tabSpaceRegistryRemoveTabSpace(chromeTabId);
    }
  }

  async function normalTabAction(
    chromeTabId: number,
    _changeInfo: chrome.tabs.TabChangeInfo,
  ) {
    const tab = await chrome.tabs.get(chromeTabId);
    if (!inCurrentTabSpace(tab.windowId, $tabSpace.getState())) {
      return;
    }
    const oldT = findTabByChromeTabId(chromeTabId, $tabSpace.getState());
    if (oldT) {
      const newT = copyChromeTabFields(tab, oldT);
      if (!eq(newT, oldT)) {
        tabSpaceStoreApi.updateTab({ tid: newT.id, changes: newT });
        saveCurrentTabSpaceIfNeeded();
      }
    }
    if (tab.active) {
      doCapturePreview(chromeTabId, tab.windowId);
    }
  }

  return (chromeTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
    logger.log('chrome tab updated:', chromeTabId, changeInfo);
    if (
      findTabSpaceIdByChromeTabId(chromeTabId, getStateTabSpaceRegistry()) &&
      changeInfo.status === 'loading'
    ) {
      // This is when one of our tabspace manager tab is reloaded
      tabSpaceAction(chromeTabId, changeInfo);
      return;
    }

    // debounce tab update because app like workplace chat will update table
    // titles frequently when there is new message.
    const debouncedNormalTabAction = debounce(
      () => normalTabAction(chromeTabId, changeInfo),
      CHROME_TAB_DEBOUNCE_TIME,
    );
    debouncedNormalTabAction();
  };
}

function getOnChromeTabMoved() {
  async function normalTabAction(
    tabId: number,
    moveInfo: chrome.tabs.TabMoveInfo,
  ) {
    await maintainTabOrder();
    saveCurrentTabSpaceIfNeeded();
  }

  return (chromeTabId: number, moveInfo: chrome.tabs.TabMoveInfo) => {
    logger.log('chrome tab moved: ', chromeTabId, moveInfo);
    if (!inCurrentTabSpace(moveInfo.windowId, $tabSpace.getState())) {
      return;
    }
    normalTabAction(chromeTabId, moveInfo);
  };
}

function getOnChromeTabActivated() {
  async function normalTabAction(activeInfo: chrome.tabs.TabActiveInfo) {
    doCapturePreview(activeInfo.tabId, activeInfo.windowId);
  }

  return (activeInfo: chrome.tabs.TabActiveInfo) => {
    logger.log('chrome tab activated:', activeInfo);
    if (!inCurrentTabSpace(activeInfo.windowId, $tabSpace.getState())) {
      return;
    }
    if (activeInfo.tabId === $tabSpace.getState().chromeTabId) {
      // do nothing when active tabspace manager tab
      return;
    }
    normalTabAction(activeInfo);
  };
}

export function startMonitorTabChanges() {
  chrome.tabs.onAttached.addListener(getOnChromeTabAttached());
  chrome.tabs.onCreated.addListener(getOnChromeTabCreated());
  chrome.tabs.onDetached.addListener(getOnChromeTabDetached());
  chrome.tabs.onRemoved.addListener(getOnChromeTabRemoved());
  chrome.tabs.onReplaced.addListener(getOnChromeTabReplaced());
  chrome.tabs.onUpdated.addListener(getOnChromeTabUpdated());
  chrome.tabs.onMoved.addListener(getOnChromeTabMoved());
  chrome.tabs.onActivated.addListener(getOnChromeTabActivated());
}
