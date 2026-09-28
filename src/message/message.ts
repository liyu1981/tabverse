import * as PubSub from 'pubsub-js';

import { logger } from '../global';

export type MsgHandler = (
  payload: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
) => void;

/** Payload of TabSpaceDBMsg.Changed / BackgroundMsg.LocalTablesChanged. */
export interface ILocalTablesChangedPayload {
  tables: string[];
}

export enum TabSpaceMsg {
  Focus = 'tabspace_focus',
  ChangeID = 'tabspace_changeid',
}

/** In-process "these tables changed" notice; payload is a list of table names. */
export enum TabSpaceDBMsg {
  Changed = 'db_changed',
}

export enum BackgroundMsg {
  AuditComplete = 'background_auditcomplete',
  /**
   * Sent by a context that wrote to the database so the *other* manager pages
   * can re-read (see data/repo/localTables.ts).
   */
  LocalTablesChanged = 'background_localtableschanged',
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
  type: BackgroundMsg.LocalTablesChanged;
  payload: ILocalTablesChangedPayload;
}): Promise<any>;

export async function sendChromeMessage(msgPayload: {
  type: string;
  payload:
    | TabSpaceId
    | TabId
    | ChromeTabId
    | AuditLogs
    | ILocalTablesChangedPayload
    | NotNeed;
}): Promise<any> {
  const result = await new Promise((resolve, _reject) => {
    chrome.runtime.sendMessage(msgPayload, (response) => {
      // a context with no listener (e.g. the worker with no page open) is the
      // normal case, not an error worth throwing on
      if (chrome.runtime.lastError) {
        logger.log(
          'send chrome runtime message had no receiver:',
          msgPayload.type,
          chrome.runtime.lastError.message,
        );
      }
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
  payload: string[],
): void;

export function sendPubSubMessage(
  type: TabSpaceMsg.ChangeID,
  payload: ITabSpaceMsgPayload,
): void;

export function sendPubSubMessage(
  type: string,
  payload: string[] | ITabSpaceMsgPayload,
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
