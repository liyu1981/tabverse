/**
 * "A server sync is running right now" - the notice the open pages use to spin
 * the sync icon (the bottom nav button, the indicator in the sync dialog).
 *
 * Delivery mirrors data/repo/localTables.ts: the context that runs the sync
 * publishes over PubSub for its own listeners and broadcasts a runtime message
 * that every *other* context turns back into a local publish. The service
 * worker is the important sender: most syncs start there (the periodic timer, a
 * realtime event, a remote edit) and not in the page that draws the icon, so
 * without the message a page would only ever see the syncs it started itself.
 *
 * Syncs nest - the pairing upload runs while a sync cycle is already going, the
 * realtime debounce can fire during a periodic one - so the state is a counter
 * and only the transitions are published, never a begin without its end.
 */

import {
  BackgroundMsg,
  sendChromeMessage,
  sendPubSubMessage,
  subscribePubSubMessage,
  SyncMsg,
  unsubscribePubSubMessage,
} from '../../message/message';
import { logger } from '../../global';

/** How many sync operations are running in this context right now. */
let running = 0;
/** The last value handed to the listeners (so repeats are not published). */
let published = false;

function publish(syncing: boolean): void {
  if (syncing === published) {
    return;
  }
  published = syncing;
  sendPubSubMessage(SyncMsg.Activity, syncing);
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    // no extension runtime (unit tests, plain page context)
    return;
  }
  void sendChromeMessage({
    type: BackgroundMsg.SyncActivityChanged,
    payload: syncing,
  }).catch((err) => logger.log('repo: sync activity notify failed:', err));
}

/** Marks a sync as started; pair every call with `endSyncActivity`. */
export function beginSyncActivity(): void {
  running += 1;
  publish(true);
}

/** Marks one running sync as finished (also on failure). */
export function endSyncActivity(): void {
  running = Math.max(0, running - 1);
  publish(running > 0);
}

/** True while a sync is running in this context. */
export function isSyncing(): boolean {
  return running > 0;
}

/** Runs `fn` with the sync icon spinning, start and end included on failure. */
export async function withSyncActivity<T>(fn: () => Promise<T>): Promise<T> {
  beginSyncActivity();
  try {
    return await fn();
  } finally {
    endSyncActivity();
  }
}

/**
 * Listens for the notice; the returned function stops listening. The callback
 * is called once with the current value so a subscriber mounted mid-sync does
 * not show a stale idle icon.
 */
export function subscribeSyncActivity(
  callback: (syncing: boolean) => void,
): () => void {
  const token = subscribePubSubMessage(SyncMsg.Activity, (_message, syncing) =>
    callback(syncing === true),
  );
  callback(isSyncing());
  return () => unsubscribePubSubMessage(token);
}
