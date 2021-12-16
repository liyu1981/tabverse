import { ChromeSession } from '../../data/chromeSession/session';
import { concat } from 'lodash';

export async function createNewChromeWindowWithTab(
  tabCreateFn: (chromeWindow: chrome.windows.Window) => Promise<any>[],
): Promise<chrome.windows.Window> {
  const chromeWindow = await chrome.windows.create({ focused: true });
  const existingTabs = await chrome.tabs.query({ windowId: chromeWindow.id });
  const allPromises = concat([], tabCreateFn(chromeWindow));
  existingTabs.forEach((tab) => allPromises.push(chrome.tabs.remove(tab.id)));
  await Promise.all(allPromises);
  return chromeWindow;
}

export async function restoreWindow(session: ChromeSession, windowId: number) {
  const window = session.windows.find((window) => window.windowId === windowId);
  if (window) {
    const tabs = session.tabs.filter((tab) => {
      return window.tabIds.findIndex((tabId) => tabId === tab.tabId) >= 0;
    });
    const chromeWindow = await createNewChromeWindowWithTab(
      (theChromeWindow) => {
        const allPromises = [];
        for (let i = 0; i < tabs.size; i++) {
          const tab = tabs.get(i);
          const p = chrome.tabs.create({
            windowId: theChromeWindow.id,
            url: tab.url,
          });
          allPromises.push(p);
        }
        return allPromises;
      },
    );
    await chrome.tabs.create({
      windowId: chromeWindow.id,
      url: 'manager.html?op=new',
    });
  }
}

export async function restoreTab(session: ChromeSession, tabId: number) {
  const tab = session.tabs.find((tab) => tab.tabId === tabId);
  if (tab) {
    createNewChromeWindowWithTab((theChromeWindow) => {
      return [
        chrome.tabs.create({ windowId: theChromeWindow.id, url: tab.url }),
      ];
    });
  }
}
