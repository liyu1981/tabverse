import { TabSpaceOp } from '../../global';
import { sendChromeMessage, TabSpaceMsg } from '../../message/message';

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
