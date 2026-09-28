/**
 * Is this browser paired with a sync server?
 *
 * The manager page needs this to decide which features can work at all:
 * switching to a Tabverse that lives in *another browser window* depends on a
 * live manager page in that window answering `BackgroundMsg.GetTabSpace` from
 * its own in-memory tabspace. With a sync server paired, the tabspace records
 * are synced and the background worker can resolve them without every window
 * having a page open, so the cross-window list is backed by data that outlives
 * any single page. Without a server the list is unreliable, so the UI hides it
 * instead of offering entries that silently do nothing (ADR 0004 explains why
 * the registry itself still exists).
 *
 * The value is derived from chrome.storage, which every extension context
 * shares, so pairing or disconnecting in one context updates the others. The
 * store starts at `false` and is filled in asynchronously, which is the
 * conservative direction: a cold start shows the feature only once a server is
 * actually known to be configured.
 */

import { StorageAreaLike } from './outbox';
import { SYNC_CONFIG_KEY, defaultStorage, loadSyncConfig } from './syncConfig';
import { createEvent, createStore } from 'effector';

export const serverSyncConfiguredChanged = createEvent<boolean>();

/** `true` once this device is paired with a server and sync is not disabled. */
export const $serverSyncConfigured = createStore<boolean>(false).on(
  serverSyncConfiguredChanged,
  (_state, configured) => configured,
);

/** Reads the stored config and publishes whether a server is configured. */
export async function refreshServerSyncConfigured(
  storage: StorageAreaLike = defaultStorage(),
): Promise<boolean> {
  const config = await loadSyncConfig(storage);
  const configured = !!config && config.enabled !== false;
  serverSyncConfiguredChanged(configured);
  return configured;
}

export interface SyncConfiguredWatchOptions {
  storage?: StorageAreaLike;
  /**
   * Called when the config key changes in another context. Defaults to
   * chrome.storage.onChanged; injected by tests.
   */
  subscribe?: (listener: () => void) => () => void;
}

function subscribeChromeStorage(listener: () => void): () => void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) {
    return () => undefined;
  }
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName === 'local' && SYNC_CONFIG_KEY in changes) {
      listener();
    }
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

/**
 * Keeps `$serverSyncConfigured` current for the lifetime of a context. Returns
 * the unsubscribe function.
 */
export function startServerSyncConfiguredWatch(
  options: SyncConfiguredWatchOptions = {},
): () => void {
  const storage = options.storage ?? defaultStorage();
  void refreshServerSyncConfigured(storage);
  const unsubscribe = (options.subscribe ?? subscribeChromeStorage)(() => {
    void refreshServerSyncConfigured(storage);
  });
  return unsubscribe;
}
