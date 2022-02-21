import * as PubSub from 'pubsub-js';

import { IDatabaseChange } from 'dexie-observable/api';
import { TabSpaceStub } from './data/tabSpace/TabSpaceRegistry';
import { logger } from './global';

export type MsgHandler = (
  payload: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
) => void;

export interface IUpdateRegistryPayload {
  from: string;
  to: string;
  entry: TabSpaceStub;
}

export interface IFullTextAddRemoveToIndexPayload {
  type: string;
  id: string;
}

export enum TabSpaceMsg {
  Focus = 'tabspace_focus',
  ChangeID = 'tabspace_changeid',
}

export enum TabSpaceDBMsg {
  Changed = 'db_changed',
}

export enum BackgroundMsg {
  AuditComplete = 'background_auditcomplete',
  GetTabSpace = 'background_gettabspace',
}

export enum FullTextSearchMsg {
  AddToIndex = 'fulltext_addtoindex',
  RemoveFromIndex = 'fulltext_removefromindex',
}

export type TabSpaceId = string;
export type TabId = string;
export type ChromeTabId = number;
export type AuditLogs = string[];
export type NotNeed = undefined | null;

export const NotNeedPayload = undefined;

export async function sendChromeMessage(msgPayload: {
  type: TabSpaceMsg.Focus;
  payload: ChromeTabId;
}): Promise<any>;

export async function sendChromeMessage(msgPayload: {
  type: BackgroundMsg.AuditComplete;
  payload: AuditLogs;
}): Promise<any>;

export async function sendChromeMessage(msgPayload: {
  type: BackgroundMsg.GetTabSpace;
  payload: ChromeTabId;
}): Promise<any>;

export async function sendChromeMessage(msgPayload: {
  type: FullTextSearchMsg.AddToIndex;
  payload: IFullTextAddRemoveToIndexPayload;
}): Promise<any>;

export async function sendChromeMessage(msgPayload: {
  type: FullTextSearchMsg.RemoveFromIndex;
  payload: IFullTextAddRemoveToIndexPayload;
}): Promise<any>;

export async function sendChromeMessage(msgPayload: {
  type: string;
  payload:
    | TabSpaceStub
    | TabSpaceId
    | TabId
    | TabSpaceStub[]
    | IUpdateRegistryPayload
    | ChromeTabId
    | AuditLogs
    | IFullTextAddRemoveToIndexPayload
    | NotNeed;
}): Promise<any> {
  const result = await new Promise((resolve, _reject) => {
    chrome.runtime.sendMessage(msgPayload, (response) => {
      logger.info('send chrome runtime message:', msgPayload);
      resolve(response);
    });
  });
  return result;
}

interface ITabSpaceMsgPayload {
  from: string;
  to: string;
}

export function sendPubSubMessage(
  type: TabSpaceDBMsg.Changed,
  payload: IDatabaseChange[],
): void;

export function sendPubSubMessage(
  type: TabSpaceMsg.ChangeID,
  payload: ITabSpaceMsgPayload,
): void;

export function sendPubSubMessage(
  type: string,
  payload: IDatabaseChange[] | ITabSpaceMsgPayload,
): void {
  PubSub.publish(type, payload);
}

export function subscribePubSubMessage(
  type: TabSpaceMsg.ChangeID,
  callback: (message: string, data: any) => void,
): void;

export function subscribePubSubMessage(
  type: TabSpaceDBMsg.Changed,
  callback: (message: string, data: any) => void,
): void;

export function subscribePubSubMessage(
  type: string,
  callback: (message: string, data: any) => void,
): void {
  PubSub.subscribe(type, callback);
}
