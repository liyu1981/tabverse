import { BackgroundMsg, sendChromeMessage } from '../../message';
import { ChromeSession, ChromeTab } from './ChromeSession';

import { TabSpace } from '../tabSpace/TabSpace';
import { strict as assert } from 'assert';
import { getTabSpaceData } from '../tabSpace/bootstrap';
import { isJestTest } from '../../debug';
import { isTabSpaceManagerPage } from '../../global';

async function updateWindowTabIds(session: ChromeSession, windowId: number) {
  const windowTabIds = (await chrome.tabs.query({ windowId: windowId })).map(
    (tab) => tab.id,
  );
  session.replaceWindowTabIds(windowId, windowTabIds);
}

async function scanCurrentTabsImpl(
  session: ChromeSession,
  tabSpaceIdResolver: (tabId: number) => Promise<string>,
) {
  const tabs = await chrome.tabs.query({});
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    let window = session.findWindow(tab.windowId);
    if (!window) {
      session.addWindow(tab.windowId);
      window = session.findWindow(tab.windowId);
    }
    if (isTabSpaceManagerPage(tab)) {
      const tabSpaceId = await tabSpaceIdResolver(tab.id);
      session.setWindowTabSpaceTabId(window.windowId, tab.id, tabSpaceId);
    } else {
      session.addTab(
        ChromeTab.new(tab.id, tab.windowId, tab.title, tab.url, tab.favIconUrl),
      );
    }
  }

  const windows = await chrome.windows.getAll();
  await Promise.all(
    windows.map((window) => {
      updateWindowTabIds(session, window.id);
    }),
  );
}

export async function scanCurrentTabsForTabSpaceManager(
  session: ChromeSession,
) {
  await scanCurrentTabsImpl(session, async (tabId: number): Promise<string> => {
    const result = getTabSpaceData().tabSpaceRegistry.registry.find(
      (stub) => stub.chromeTabId === tabId,
    );
    assert(result, `must find an entry for chrome tab ${tabId}, but not!`);
    return Promise.resolve(result.id);
  });
}

export async function scanCurrentTabsForBackground(session: ChromeSession) {
  await scanCurrentTabsImpl(session, async (tabId: number): Promise<string> => {
    if (isJestTest()) {
      // when in jest test mode, tabSpaceId will be fake
      return Promise.resolve('jest-test');
    } else {
      const tabSpace: TabSpace = await sendChromeMessage({
        type: BackgroundMsg.GetTabSpace,
        payload: tabId,
      });
      return tabSpace.id;
    }
  });
}
