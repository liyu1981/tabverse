/**
 * "These tables changed in this browser profile" - the notification the open
 * manager pages listen to.
 *
 * This replaces the cross-context part of dexie-observable's `db.on('changes')`
 * event. Two delivery paths are needed because the writers and the readers are
 * different contexts:
 *
 *  - a context that wrote publishes over PubSub (same context listeners, e.g.
 *    the page reacting to its own edits);
 *  - it also sends a runtime message, which every *other* extension context
 *    receives; `message/chromeMessage` re-publishes it locally. The service
 *    worker is the important sender: it writes chrome session snapshots and
 *    the records the sync engine pulls, and no page sees those in its own
 *    Dexie hooks.
 *
 * The payload is just the table names: the listeners re-query, they do not need
 * row diffs.
 */

import {
  BackgroundMsg,
  sendChromeMessage,
  sendPubSubMessage,
  TabSpaceDBMsg,
} from '../../message/message';
import { logger } from '../../global';

/**
 * Tables written by the sync engine worth telling pages about: the manager
 * page re-reads the tabverse and the closed tab list when they change. Closed
 * tabs are included because another device (or another window) can close tabs
 * in a tabverse this page is showing.
 */
const NOTIFY_TABLES = new Set(['SavedTabSpace', 'SavedTab', 'SavedClosedTab']);

export function notifyLocalTablesChanged(tables: string[]): void {
  const unique = Array.from(new Set(tables.filter((t) => !!t)));
  if (unique.length === 0) {
    return;
  }
  sendPubSubMessage(TabSpaceDBMsg.Changed, unique);
  if (!unique.some((t) => NOTIFY_TABLES.has(t))) {
    return;
  }
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    // no extension runtime (unit tests, plain page context)
    return;
  }
  // no receiver (no manager page open) is the normal case in the worker
  void sendChromeMessage({
    type: BackgroundMsg.LocalTablesChanged,
    payload: { tables: unique },
  }).catch((err) => logger.log('repo: local tables notify failed:', err));
}
