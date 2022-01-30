import {
  AuditLogs,
  BackgroundMsg,
  ChromeTabId,
  IUpdateRegistryPayload,
  TabSpaceId,
  TabSpaceMsg,
  TabSpaceRegistryMsg,
  sendChromeMessage,
} from '../../message';
import { TabSpaceRegistry, TabSpaceStub } from './TabSpaceRegistry';

import { getTabSpaceData } from './bootstrap';
import { logger } from '../../global';

const handlers = {};

handlers[TabSpaceRegistryMsg.Announce] = function (
  tabSpaceRegistry: TabSpaceRegistry,
  message: {
    type: TabSpaceRegistryMsg.Announce;
    payload: TabSpaceStub[];
  },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
) {
  function action() {
    const changed = tabSpaceRegistry.mergeRegistry(message.payload);
    if (changed) {
      sendChromeMessage({
        type: TabSpaceRegistryMsg.Announce,
        payload: tabSpaceRegistry.toMsgPayload(),
      });
    }
  }
  logger.log(
    'chromeMessage got:',
    TabSpaceRegistryMsg.Announce,
    JSON.stringify(message),
  );
  action();
  sendResponse && sendResponse();
};

handlers[TabSpaceRegistryMsg.AddTabSpace] = function (
  tabSpaceRegistry: TabSpaceRegistry,
  message: {
    type: TabSpaceRegistryMsg.AddTabSpace;
    payload: TabSpaceStub;
  },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
) {
  function normalTabAction() {
    const tStub = message.payload as TabSpaceStub;
    const changed = tabSpaceRegistry.mergeRegistryChanges([
      {
        from: tStub.id,
        to: tStub.id,
        entry: tStub,
      },
    ]);
    if (changed) {
      sendChromeMessage({
        type: TabSpaceRegistryMsg.Announce,
        payload: tabSpaceRegistry.toMsgPayload(),
      });
    }
  }
  logger.log(
    'chromeMessage got:',
    TabSpaceRegistryMsg.AddTabSpace,
    JSON.stringify(message),
  );
  normalTabAction();
  sendResponse && sendResponse();
};

handlers[TabSpaceRegistryMsg.UpdateRegistry] = function (
  tabSpaceRegistry: TabSpaceRegistry,
  message: {
    type: TabSpaceRegistryMsg.UpdateRegistry;
    payload: IUpdateRegistryPayload;
  },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
) {
  function action() {
    tabSpaceRegistry.mergeRegistryChanges([message.payload]);
  }
  logger.log(
    'chromeMessage got:',
    TabSpaceRegistryMsg.UpdateRegistry,
    JSON.stringify(message),
  );
  action();
  sendResponse && sendResponse();
};

handlers[TabSpaceRegistryMsg.RemoveTabSpace] = function (
  tabSpaceRegistry: TabSpaceRegistry,
  message: {
    type: TabSpaceRegistryMsg.RemoveTabSpace;
    payload: TabSpaceId;
  },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
) {
  function action() {
    tabSpaceRegistry.remove(message.payload);
  }
  logger.log('chromeMessage got:', TabSpaceRegistryMsg.RemoveTabSpace, message);
  action();
  sendResponse && sendResponse();
};

handlers[TabSpaceMsg.Focus] = function (
  tabSpaceRegistry: TabSpaceRegistry,
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
  tabSpaceRegistry: TabSpaceRegistry,
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
  tabSpaceRegistry: TabSpaceRegistry,
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

function onMessage(tabSpaceRegistry: TabSpaceRegistry) {
  return (
    message: {
      type: string;
      payload: any;
    },
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void,
  ) => {
    if (message.type && message.type in handlers) {
      handlers[message.type](tabSpaceRegistry, message, sender, sendResponse);
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

export function startMonitorTabSpaceRegistryChanges(
  tabSpaceRegistry: TabSpaceRegistry,
) {
  chrome.runtime.onMessage.addListener(onMessage(tabSpaceRegistry));
}
