import {
  addTab,
  addWindow,
  ChromeSession,
  ChromeTab,
  cloneChromeSession,
  findWindow,
  replaceWindowTabIds,
} from './ChromeSession';

async function updateWindowTabIds(
  windowId: number,
  targetChromeSession: ChromeSession,
): Promise<ChromeSession> {
  const windowTabIds = (await chrome.tabs.query({ windowId: windowId })).map(
    (tab) => tab.id,
  );
  return replaceWindowTabIds(windowId, windowTabIds, targetChromeSession);
}

/**
 * Snapshots the browser's windows and tabs into a session record.
 *
 * Every tab is recorded as a plain tab of its window. Older versions used to
 * mark the Tabverse manager tab of each window (tabSpaceTabId/tabSpaceId in the
 * window entry) by asking the other windows which tabverse they were showing;
 * each manager page now owns exactly its own window, so there is nobody to ask
 * and the marker is never set. The two fields stay in the payload so sessions
 * written by earlier versions still restore.
 */
export async function scanCurrentTabsForSession(
  targetChromeSession: ChromeSession,
): Promise<ChromeSession> {
  let newChromeSession = cloneChromeSession(targetChromeSession);
  const tabs = await chrome.tabs.query({});
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    if (!findWindow(tab.windowId, newChromeSession)) {
      newChromeSession = addWindow(tab.windowId, newChromeSession);
    }
    newChromeSession = addTab(
      ChromeTab.new(tab.id, tab.windowId, tab.title, tab.url, tab.favIconUrl),
      newChromeSession,
    );
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
