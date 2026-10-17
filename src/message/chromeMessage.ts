import {
  AuditLogs,
  BackgroundMsg,
  ChromeTabId,
  DedupMsg,
  ILocalTablesChangedPayload,
  SyncMsg,
  TabSpaceDBMsg,
  TabSpaceMsg,
} from './message';

import { logger } from '../global';
import { receiveDedupReport } from '../data/tabSpace/dedupMessages';
import { sendPubSubMessage } from './message';

const handlers = {};

handlers[TabSpaceMsg.Focus] = function (
  message: {
    type: TabSpaceMsg.Focus;
    payload: ChromeTabId;
  },
  _sender: chrome.runtime.MessageSender,
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
  _sender: chrome.runtime.MessageSender,
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
  _sender: chrome.runtime.MessageSender,
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

// The wizard landed a token in the worker (adr/0020): an open sync dialog has
// to redraw, and this is the same "another context changed something you draw"
// notice the other two are.
handlers[BackgroundMsg.SyncConfigChanged] = function (
  message: {
    type: BackgroundMsg.SyncConfigChanged;
    payload: boolean;
  },
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
) {
  logger.log(
    'chromeMessage got:',
    BackgroundMsg.SyncConfigChanged,
    message.payload,
  );
  sendPubSubMessage(SyncMsg.ConfigChanged, message.payload === true);
  sendResponse && sendResponse();
};

handlers[BackgroundMsg.SyncActivityChanged] = function (
  message: {
    type: BackgroundMsg.SyncActivityChanged;
    payload: boolean;
  },
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
) {
  // another context (usually the service worker) started or finished a sync;
  // re-publish locally so this page's sync icon reacts
  logger.log('chromeMessage got:', BackgroundMsg.SyncActivityChanged);
  sendPubSubMessage(SyncMsg.Activity, message.payload === true);
  sendResponse && sendResponse();
};

// The worker finished a dedup scan (adr/0033): the notice draws the new report.
handlers[DedupMsg.ReportChanged] = function (
  message: {
    type: DedupMsg.ReportChanged;
    payload: unknown;
  },
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
) {
  logger.log('chromeMessage got:', DedupMsg.ReportChanged);
  receiveDedupReport(message.payload ?? null);
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
