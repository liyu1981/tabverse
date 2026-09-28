import { TabSpaceOp } from '../../global';
import { sendChromeMessage, TabSpaceMsg } from '../../message/message';
import { concat } from 'lodash';

export function switchToTabSpaceUtil(
  chromeTabId: number,
  chromeWindowId: number,
  willSendChromeMessage = true,
) {
  if (willSendChromeMessage) {
    sendChromeMessage({
      type: TabSpaceMsg.Focus,
      payload: chromeTabId,
    });
  }
  chrome.windows.update(chromeWindowId, { focused: true });
}

/**
 * Opens a new window, hands it to `tabCreateFn` and closes the tabs Chrome put
 * there by default. Used when restoring a saved tabverse into a new window.
 */
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

export function restoreSavedTabSpaceUtil(tabSpaceId: string) {
  chrome.windows.create((window) => {
    chrome.tabs.create({
      active: true,
      pinned: true,
      url: `manager.html?op=${TabSpaceOp.LoadSaved}&stsid=${tabSpaceId}`,
      windowId: window.id,
    });
  });
}

export function loadToCurrentWindowUtil(savedTabSpaceId: string) {
  window.open(
    `manager.html?op=${TabSpaceOp.LoadSaved}&stsid=${savedTabSpaceId}`,
    '_self',
  );
}
