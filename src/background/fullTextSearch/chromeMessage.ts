import {
  FullTextSearchMsg,
  IFullTextAddRemoveToIndexPayload,
} from '../../message';

import { addToIndexHandlers } from './addToIndex';
import { logger } from '../../global';
import { removeFromIndexGeneralHandler } from './removeFromIndex';

const handlers = {};

handlers[FullTextSearchMsg.AddToIndex] = (
  message: { type: string; payload: IFullTextAddRemoveToIndexPayload },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
) => {
  logger.info(`FullTextSearch: AddToIndex requested with ${message.payload}.`);
  const { type, id } = message.payload;
  if (type && type in addToIndexHandlers) {
    removeFromIndexGeneralHandler(id).then(() => {
      addToIndexHandlers[type](type, id);
    });
  } else {
    logger.log(`Do not know how to add type ${type} into index, skip.`);
  }
  sendResponse && sendResponse();
  return true;
};

handlers[FullTextSearchMsg.RemoveFromIndex] = (
  message: { type: string; payload: IFullTextAddRemoveToIndexPayload },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
) => {
  logger.info(
    `FullTextSearch: RemoveFromIndex requested with ${message.payload}`,
  );
  const { id } = message.payload;
  removeFromIndexGeneralHandler(id);
  sendResponse && sendResponse();
  return true;
};

function onMessage(
  message: {
    type: string;
    payload: any;
  },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
) {
  if (message.type && message.type in handlers) {
    handlers[message.type](message, sender, sendResponse);
  }
  return true;
}

export function monitorFullTextSearchMsg() {
  chrome.runtime.onMessage.addListener(onMessage);
}
