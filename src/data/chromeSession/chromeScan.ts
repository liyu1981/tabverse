import { BackgroundMsg, sendChromeMessage } from '../../message/message';
import {
  addTab,
  addWindow,
  ChromeSession,
  ChromeTab,
  cloneChromeSession,
  findWindow,
  replaceWindowTabIds,
  setWindowTabSpaceTabId,
} from './ChromeSession';

import { isJestTest } from '../../debug';
import { assert, isTabSpaceManagerPage, logger } from '../../global';
import { TabSpace } from '../tabSpace/TabSpace';
import { getStateTabSpaceRegistry } from '../tabSpaceRegistry/store';

async function updateWindowTabIds(
  windowId: number,
  targetChromeSession: ChromeSession,
): Promise<ChromeSession> {
  const windowTabIds = (await chrome.tabs.query({ windowId: windowId })).map(
    (tab) => tab.id,
  );
  return replaceWindowTabIds(windowId, windowTabIds, targetChromeSession);
}

async function scanCurrentTabsImpl(
  tabSpaceIdResolver: (tabId: number) => Promise<string>,
  targetChromeSession: ChromeSession,
): Promise<ChromeSession> {
  let newChromeSession = cloneChromeSession(targetChromeSession);
  const tabs = await chrome.tabs.query({});
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    let window = findWindow(tab.windowId, newChromeSession);
    if (!window) {
      newChromeSession = addWindow(tab.windowId, newChromeSession);
      window = findWindow(tab.windowId, newChromeSession);
    }
    if (isTabSpaceManagerPage(tab)) {
      const tabSpaceId = await tabSpaceIdResolver(tab.id);
      if (tabSpaceId) {
        newChromeSession = setWindowTabSpaceTabId(
          window.windowId,
          tab.id,
          tabSpaceId,
          newChromeSession,
        );
      } else {
        // No live context claimed this window's tabverse: its manager page may
        // have been closed since chrome.tabs.query, or (without a paired sync
        // server) the background simply has no way to resolve it. Keep the tab
        // as a normal tab of its window instead of failing the whole scan.
        logger.info(
          `no tabspace resolved for manager tab ${tab.id} in window ${tab.windowId}`,
        );
        newChromeSession = addTab(
          ChromeTab.new(
            tab.id,
            tab.windowId,
            tab.title,
            tab.url,
            tab.favIconUrl,
          ),
          newChromeSession,
        );
      }
    } else {
      newChromeSession = addTab(
        ChromeTab.new(tab.id, tab.windowId, tab.title, tab.url, tab.favIconUrl),
        newChromeSession,
      );
    }
  }

  const windows = await chrome.windows.getAll();
  for (let i = 0; i < windows.length; i++) {
    newChromeSession = await updateWindowTabIds(
      windows[i].id,
      newChromeSession,
    );
  }

  return newChromeSession;
}

export async function scanCurrentTabsForTabSpaceManager(
  targetChromeSession: ChromeSession,
): Promise<ChromeSession> {
  return await scanCurrentTabsImpl(async (tabId: number): Promise<string> => {
    const result = getStateTabSpaceRegistry().find(
      (stub) => stub.chromeTabId === tabId,
    );
    if (isJestTest()) {
      return Promise.resolve('jest test tabspace');
    } else {
      assert(result, `must find an entry for chrome tab ${tabId}, but not!`);
      return Promise.resolve(result.id);
    }
  }, targetChromeSession);
}

export async function scanCurrentTabsForBackground(
  targetChromeSession: ChromeSession,
): Promise<ChromeSession> {
  return await scanCurrentTabsImpl(async (tabId: number): Promise<string> => {
    if (isJestTest()) {
      // when in jest test mode, tabSpaceId will be fake
      return Promise.resolve('jest-test');
    } else {
      const tabSpace: TabSpace = await sendChromeMessage({
        type: BackgroundMsg.GetTabSpace,
        payload: tabId,
      });
      // no responder (page closed, or no sync server to resolve it with):
      // the caller falls back to recording the tab as a plain window tab
      return tabSpace ? tabSpace.id : null;
    }
  }, targetChromeSession);
}
