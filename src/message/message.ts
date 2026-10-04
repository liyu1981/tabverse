import * as PubSub from 'pubsub-js';

import { logger } from '../global';

/** Payload of TabSpaceDBMsg.Changed / BackgroundMsg.LocalTablesChanged. */
export interface ILocalTablesChangedPayload {
  tables: string[];
}

export enum TabSpaceMsg {
  Focus = 'tabspace_focus',
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
  /**
   * Sent by a context that started or finished a server sync so the *other*
   * manager pages can spin their sync icon (see data/repo/syncActivity.ts).
   */
  SyncActivityChanged = 'background_syncactivitychanged',
  /**
   * Sent by the service worker after the official-server wizard handed it a
   * token (adr/0020), so an open sync dialog redraws itself as connected
   * without being reopened.
   */
  SyncConfigChanged = 'background_syncconfigchanged',
}

/** In-process "a sync is running" notice; payload is a boolean. */
export enum SyncMsg {
  Activity = 'sync_activity',
  /** In-process "the sync config changed" notice (the wizard paired us). */
  ConfigChanged = 'sync_config_changed',
}

export type TabSpaceId = string;
export type TabId = string;
export type ChromeTabId = number;
export type AuditLogs = string[];
export type NotNeed = undefined | null;

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
  type: BackgroundMsg.SyncActivityChanged;
  payload: boolean;
}): Promise<any>;

export async function sendChromeMessage(msgPayload: {
  type: BackgroundMsg.SyncConfigChanged;
  payload: boolean;
}): Promise<any>;

export async function sendChromeMessage(msgPayload: {
  type: string;
  payload:
    | TabSpaceId
    | TabId
    | ChromeTabId
    | AuditLogs
    | ILocalTablesChangedPayload
    | boolean
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

export function sendPubSubMessage(
  type: TabSpaceDBMsg.Changed,
  payload: string[],
): void;

export function sendPubSubMessage(
  type: SyncMsg.Activity,
  payload: boolean,
): void;

export function sendPubSubMessage(
  type: SyncMsg.ConfigChanged,
  payload: boolean,
): void;

export function sendPubSubMessage(
  type: string,
  payload: string[] | boolean,
): void {
  PubSub.publish(type, payload);
}

export function subscribePubSubMessage(
  type: TabSpaceDBMsg.Changed,
  callback: (message: string, data: any) => void,
): string;

export function subscribePubSubMessage(
  type: SyncMsg.Activity,
  callback: (message: string, data: boolean) => void,
): string;

export function subscribePubSubMessage(
  type: SyncMsg.ConfigChanged,
  callback: (message: string, data: boolean) => void,
): string;

export function subscribePubSubMessage(
  type: string,
  callback: (message: string, data: any) => void,
): string {
  return PubSub.subscribe(type, callback);
}

/** Stops a listener started by `subscribePubSubMessage`. */
export function unsubscribePubSubMessage(token: string): void {
  PubSub.unsubscribe(token);
}
