import { $tabSpace, tabSpaceStoreApi } from './store';
import { Tab, fromLiveTab, setTabSpaceId } from './Tab';
import { TabSpace, findTabByChromeTabId } from './TabSpace';
import { debounce, isTabSpaceManagerPage, logger } from '../../global';

import { eq, isEqual, omit } from 'lodash';
import { getUnsavedNewId } from '../common';
import { isJestTest } from '../../debug';
import { produce } from 'immer';
import { recordClosedTab } from '../closedTab/util';
import { saveCurrentTabSpaceIfNeeded } from './util';
import { captureTabGroups, startMonitorTabGroups } from './tabGroup';
import { persistPreview } from './tabPreviewStore';

const CHROME_TAB_DEBOUNCE_TIME = 500;

function inCurrentTabSpace(windowId: number, tabSpace: TabSpace) {
  return windowId === tabSpace.chromeWindowId;
}

/**
 * What a page may rewrite about itself without becoming a different tab: its
 * title and its favicon.
 */
const TAB_METADATA_ONLY_FIELDS = ['title', 'favIconUrl'];

/**
 * True when the only thing that changed about a tab is page metadata. Chrome
 * rewrites the title (and favicon) of a chat app on every message, favicon of
 * a site on every deploy; saving the whole tabverse - and pushing the row to
 * the server through the change feed - for each of those is pure churn. The
 * store still takes the new title, so the next real save persists it.
 *
 * Everything else counts as a change worth saving, url above all: a different
 * url (query params and hash included) is a different page, and pinned,
 * suspended and the split view id describe the tab itself.
 */
function isTabMetadataOnlyChange(oldTab: Tab, newTab: Tab): boolean {
  return isEqual(
    omit(newTab, TAB_METADATA_ONLY_FIELDS),
    omit(oldTab, TAB_METADATA_ONLY_FIELDS),
  );
}

function copyChromeTabFields(chromeTab: chrome.tabs.Tab, targetTab: Tab): Tab {
  return produce(targetTab, (draft) => {
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
    if (chromeTab.splitViewId !== undefined) {
      draft.splitViewId =
        chromeTab.splitViewId === chrome.tabs.SPLIT_VIEW_ID_NONE
          ? undefined
          : chromeTab.splitViewId;
    }
  });
}

export async function scanCurrentTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const newTabs: Tab[] = [];
  const tabSpace = $tabSpace.getState();
  const tabIdByChromeTabId = new Map<number, string>();
  tabs.forEach((tab) => {
    if (isTabSpaceManagerPage(tab)) {
      return;
    }
    const existing = findTabByChromeTabId(tab.id, tabSpace);
    if (existing) {
      tabIdByChromeTabId.set(tab.id, existing.id);
      return;
    }
    let t = fromLiveTab({
      chromeTabId: tab.id,
      chromeWindowId: tab.windowId,
    });
    t = copyChromeTabFields(tab, t);
    newTabs.push(t);
    tabIdByChromeTabId.set(tab.id, t.id);
  });
  if (newTabs.length > 0) {
    tabSpaceStoreApi.addTabs(newTabs);
  }
  await captureGroupsOfWindow(tabIdByChromeTabId);
}

/**
 * Tab groups are an enrichment pass on top of the baseline scan: it runs after
 * the tabs are in the store, and returns quietly when the browser has no
 * chrome.tabGroups (see src/capabilities.ts).
 */
async function captureGroupsOfWindow(tabIdByChromeTabId: Map<number, string>) {
  const windowId = $tabSpace.getState().chromeWindowId;
  if (windowId < 0 || tabIdByChromeTabId.size === 0) {
    return;
  }
  const groups = await captureTabGroups(windowId, tabIdByChromeTabId);
  if (groups) {
    tabSpaceStoreApi.setTabGroups(groups);
  }
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
          // the cache dies with the page; the durable copy is what makes a
          // thumbnail still there after a reload
          void persistPreview(chromeTabId, dataUrl);
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
  saveCurrentTabSpaceIfNeeded();
}

export function getOnChromeTabAttached() {
  async function tabSpaceAction(
    chromeTabId: number,
    _attachInfo: chrome.tabs.OnAttachedInfo,
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

    doCapturePreview(chromeTabId, chromeTab.windowId);
  }

  async function normalTabAction(
    tabId: number,
    _attachInfo: chrome.tabs.OnAttachedInfo,
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

  return (chromeTabId: number, attachInfo: chrome.tabs.OnAttachedInfo) => {
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
    _detachInfo: chrome.tabs.OnDetachedInfo,
  ) {
    // a tab moved to another window left this tabverse; the History tool
    // remembers it too, like Chrome's own "recently closed" does
    const detachedTab = findTabByChromeTabId(chromeTabId, $tabSpace.getState());
    if (detachedTab) {
      recordClosedTab(detachedTab);
    }
    tabSpaceStoreApi.removeTabByChromeTabId(chromeTabId);
    tabSpaceStoreApi.removePreview(chromeTabId);
    // the durable row is the worker's to drop (see previewReaper): it owns every
    // delete of that table, on the tab event and on its timer alike
    saveCurrentTabSpaceIfNeeded();
  }

  return (chromeTabId: number, detachInfo: chrome.tabs.OnDetachedInfo) => {
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
  const normalTabAction = (
    chromeTabId: number,
    _removeInfo: chrome.tabs.OnRemovedInfo,
  ) => {
    // recorded before the tab leaves the store: this is the only place where
    // the title/url of a tab being closed is still known (see the History tool
    // in data/closedTab)
    const removedTab = findTabByChromeTabId(chromeTabId, $tabSpace.getState());
    if (removedTab) {
      recordClosedTab(removedTab);
    }
    tabSpaceStoreApi.removeTabByChromeTabId(chromeTabId);
    tabSpaceStoreApi.removePreview(chromeTabId);
    // the durable row is the worker's to drop (see previewReaper): it owns every
    // delete of that table, on the tab event and on its timer alike
    saveCurrentTabSpaceIfNeeded();
  };

  return (chromeTabId: number, removeInfo: chrome.tabs.OnRemovedInfo) => {
    logger.log('chrome tab removed:', chromeTabId, removeInfo);
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
  /**
   * One debounced action per tab, not one per event: a chat app rewriting its
   * title fires onUpdated every few seconds, and a debounce built inside the
   * listener is a fresh (never fired) debounce each time - it debounced
   * nothing at all. Per tab, so a busy tab cannot swallow the update of the
   * tab next to it.
   */
  const debouncedActions = new Map<number, () => void>();

  function scheduleTabUpdate(chromeTabId: number) {
    let action = debouncedActions.get(chromeTabId);
    if (!action) {
      action = debounce(() => {
        // drop the entry once it fired, so the next burst starts a fresh
        // window and the map does not keep a closure per tab forever
        debouncedActions.delete(chromeTabId);
        return normalTabAction(chromeTabId);
      }, CHROME_TAB_DEBOUNCE_TIME);
      debouncedActions.set(chromeTabId, action);
    }
    action();
  }

  async function normalTabAction(chromeTabId: number) {
    const tab = await chrome.tabs.get(chromeTabId);
    if (!inCurrentTabSpace(tab.windowId, $tabSpace.getState())) {
      return;
    }
    const oldT = findTabByChromeTabId(chromeTabId, $tabSpace.getState());
    if (oldT) {
      const newT = copyChromeTabFields(tab, oldT);
      if (!eq(newT, oldT)) {
        const metadataOnly = isTabMetadataOnlyChange(oldT, newT);
        tabSpaceStoreApi.updateTab({ tid: newT.id, changes: newT });
        if (metadataOnly) {
          logger.log(
            'chrome tab metadata only update, no tabverse auto save:',
            chromeTabId,
          );
        } else {
          saveCurrentTabSpaceIfNeeded();
        }
      }
    }
    if (tab.active) {
      doCapturePreview(chromeTabId, tab.windowId);
    }
  }

  return (chromeTabId: number, changeInfo: chrome.tabs.OnUpdatedInfo) => {
    logger.log('chrome tab updated:', chromeTabId, changeInfo);
    if (changeInfo.groupId !== undefined) {
      // the tab moved in or out of a group: rebuild the group hints
      void captureGroupsOfWindow(currentTabIdMapping());
    }
    // debounce tab update because app like workplace chat will update table
    // titles frequently when there is new message.
    scheduleTabUpdate(chromeTabId);
  };
}

function getOnChromeTabMoved() {
  async function normalTabAction(
    tabId: number,
    moveInfo: chrome.tabs.OnMovedInfo,
  ) {
    await maintainTabOrder();
    saveCurrentTabSpaceIfNeeded();
  }

  return (chromeTabId: number, moveInfo: chrome.tabs.OnMovedInfo) => {
    logger.log('chrome tab moved: ', chromeTabId, moveInfo);
    if (!inCurrentTabSpace(moveInfo.windowId, $tabSpace.getState())) {
      return;
    }
    normalTabAction(chromeTabId, moveInfo);
  };
}

function getOnChromeTabActivated() {
  async function normalTabAction(activeInfo: chrome.tabs.OnActivatedInfo) {
    doCapturePreview(activeInfo.tabId, activeInfo.windowId);
  }

  return (activeInfo: chrome.tabs.OnActivatedInfo) => {
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
  // group title/colour/collapse changes; membership of a single tab arrives
  // through tabs.onUpdated's changeInfo.groupId
  startMonitorTabGroups(() => {
    void captureGroupsOfWindow(currentTabIdMapping());
  });
}

/** chrome tab id -> our tab id for every tab of the current window */
function currentTabIdMapping(): Map<number, string> {
  const map = new Map<number, string>();
  const tabSpace = $tabSpace.getState();
  tabSpace.tabs.forEach((tab: Tab) => {
    if (tab.chromeTabId >= 0) {
      map.set(tab.chromeTabId, tab.id);
    }
  });
  return map;
}
