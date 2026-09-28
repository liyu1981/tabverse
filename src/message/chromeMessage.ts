import {
  AuditLogs,
  BackgroundMsg,
  ChromeTabId,
  ILocalTablesChangedPayload,
  TabSpaceDBMsg,
  TabSpaceMsg,
} from './message';

import { logger } from '../global';
import { sendPubSubMessage } from './message';

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

handlers[BackgroundMsg.LocalTablesChanged] = function (
  message: {
    type: BackgroundMsg.LocalTablesChanged;
    payload: ILocalTablesChangedPayload;
  },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
) {
  // another context (usually the service worker) wrote to the database;
  // re-publish locally so this page's listeners re-query
  logger.log(
    'chromeMessage got:',
    BackgroundMsg.LocalTablesChanged,
    message.payload,
  );
  sendPubSubMessage(TabSpaceDBMsg.Changed, message.payload.tables);
  sendResponse && sendResponse();
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
