import { AuditLogs, BackgroundMsg, ChromeTabId, TabSpaceMsg } from './message';

import { getTabSpaceData } from '../data/tabSpace/bootstrap';
import { logger } from '../global';

const handlers = {};

handlers[TabSpaceMsg.Focus] = function (
  message: {
    type: TabSpaceMsg.Focus;
    payload: ChromeTabId;
  },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
) {
  function action() {
    chrome.tabs.update(message.payload, { active: true });
  }
  logger.log('chromeMessage got:', TabSpaceMsg.Focus, JSON.stringify(message));
  action();
  sendResponse && sendResponse();
};

handlers[BackgroundMsg.AuditComplete] = function (
  message: {
    type: BackgroundMsg.AuditComplete;
    payload: AuditLogs;
  },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
) {
  logger.info(`${BackgroundMsg.AuditComplete}\n${message.payload.join('\n')}`);
  sendResponse && sendResponse();
};

handlers[BackgroundMsg.GetTabSpace] = function (
  message: {
    type: BackgroundMsg.GetTabSpace;
    payload: ChromeTabId;
  },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
) {
  logger.info(`${BackgroundMsg.GetTabSpace}, ${message.payload}`);
  if (message.payload === getTabSpaceData().tabSpace.chromeTabId) {
    sendResponse(getTabSpaceData().tabSpace);
  }
};

function onMessage() {
  return (
    message: {
      type: string;
      payload: any;
    },
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void,
  ) => {
    if (message.type && message.type in handlers) {
      handlers[message.type](message, sender, sendResponse);
    } else {
      logger.log(
        'Do not know how to handle chrome runtime message:',
        JSON.stringify(message),
        sender.id,
      );
    }
    return true;
  };
}

export function startMonitorChromeMessage() {
  chrome.runtime.onMessage.addListener(onMessage());
}
