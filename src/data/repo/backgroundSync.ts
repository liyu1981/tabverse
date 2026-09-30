/**
 * Background sync runtime: everything the MV3 service worker needs to stay
 * converged with the server.
 *
 *   chrome.storage.local (config, outbox, cursor)
 *        ^                        |
 *        |  change feed           v
 *   Dexie writes ---------> SyncEngine.flush/pull <--- RealtimeClient events
 *
 * All collaborators are injectable so the runtime can be unit tested without
 * chrome, a network or a real WebSocket.
 */

import { runAsRemoteApply, startChangeFeed } from './changeFeed';
import { applyServerRecords, listLocalRecords } from './dbBridge';
import { ChromeStorageArea, Outbox, StorageAreaLike } from './outbox';
import { RealtimeClient, Scheduler, WebSocketFactory } from './realtime';
import { FetchLike, ServerApiClient } from './serverApi';
import {
  ChromeSyncStateStore,
  SyncEngine,
  SyncHooks,
  SyncOutcome,
  SyncStateStore,
} from './repo';
import {
  DEFAULT_SYNC_INTERVAL_MS,
  SyncConfig,
  loadSyncConfig,
} from './syncConfig';
import { withSyncActivity } from './syncActivity';
import { SyncRecord } from './types';
import { logger } from '../../global';

export interface SyncRuntimeDeps {
  storage?: StorageAreaLike;
  fetchFn?: FetchLike;
  webSocketFactory?: WebSocketFactory;
  scheduler?: Scheduler;
  stateStore?: SyncStateStore;
  /** Set 0 to disable periodic sync (tests). */
  autoSyncIntervalMs?: number;
}

export interface SyncRuntime {
  engine: SyncEngine;
  realtime: RealtimeClient | null;
  config: SyncConfig;
  /** Run one sync cycle now (used by the realtime events and the dialog). */
  syncNow(): Promise<SyncOutcome>;
  stop(): void;
}

const DEBOUNCE_MS = 1500;

/** Builds the full runtime for a config; starts the realtime connection. */
export function createSyncRuntime(
  config: SyncConfig,
  deps: SyncRuntimeDeps = {},
): SyncRuntime {
  const storage = deps.storage || new ChromeStorageArea();
  const api = new ServerApiClient({
    baseUrl: config.baseUrl,
    token: config.token,
    fetchFn: deps.fetchFn,
  });
  const outbox = new Outbox(storage);
  const stateStore = deps.stateStore || new ChromeSyncStateStore(storage);

  const hooks: SyncHooks = {
    onRecords: async (records: SyncRecord[]) => {
      await runAsRemoteApply(() => applyServerRecords(records));
    },
    onConflict: async (_local, current) => {
      await runAsRemoteApply(() => applyServerRecords([current]));
    },
    onError: (err) => {
      if (err.isAuthError) {
        logger.error(
          'repo: sync rejected the device token, re-pairing required:',
          err.message,
        );
      } else {
        logger.log('repo: sync error:', err.code, err.message);
      }
    },
  };

  const engine = new SyncEngine(api, outbox, stateStore, hooks);

  // Debounced trigger: realtime events and the interval both funnel through
  // the engine's own "already syncing" guard. The activity wrapper is what
  // makes the open pages spin their sync icon (see syncActivity.ts).
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const syncNow = () => withSyncActivity(() => engine.syncOnce());
  const triggerSync = () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void syncNow();
    }, DEBOUNCE_MS);
  };

  let realtime: RealtimeClient | null = null;
  try {
    realtime = new RealtimeClient({
      url: api.streamUrl(),
      onMessage: (message) => {
        if (message.type === 'records_changed') {
          triggerSync();
        }
      },
      onStatus: (status) => {
        logger.log('repo: realtime status:', status);
        if (status === 'connected') {
          // catch up on anything missed while disconnected
          void syncNow();
        }
      },
      factory: deps.webSocketFactory,
      scheduler: deps.scheduler,
    });
    realtime.connect();
  } catch (err) {
    logger.log('repo: realtime connection failed to start:', err);
    realtime = null;
  }

  const interval =
    deps.autoSyncIntervalMs !== undefined
      ? deps.autoSyncIntervalMs
      : config.autoSyncIntervalMs !== undefined
        ? config.autoSyncIntervalMs
        : DEFAULT_SYNC_INTERVAL_MS;

  if (interval > 0) {
    engine.startAutoSync(interval);
  }

  return {
    engine,
    realtime,
    config,
    syncNow,
    stop: () => {
      engine.stopAutoSync();
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (realtime) {
        realtime.disconnect();
      }
    },
  };
}

let running: SyncRuntime | null = null;

/**
 * Starts background sync if the device is configured. Called from the
 * service worker entry point; a no-op (returns null) otherwise.
 *
 * The change feed is started either way: the worker writes chrome session
 * snapshots and the records the engine pulls, and open manager pages have to
 * hear about those writes even when the device is not paired with a server.
 */
export async function startBackgroundSync(
  deps: SyncRuntimeDeps = {},
): Promise<SyncRuntime | null> {
  if (running) {
    return running;
  }
  const storage = deps.storage || new ChromeStorageArea();

  await startChangeFeed({ storage });

  const config = await loadSyncConfig(storage).catch((err) => {
    logger.log('repo: cannot read sync config:', err);
    return null;
  });
  if (!config || !config.enabled) {
    logger.log('repo: sync not configured, running local only');
    return null;
  }

  running = createSyncRuntime(config, { ...deps, storage });
  logger.log('repo: background sync started for', config.baseUrl);

  // catch up immediately; failures are logged by the engine hooks
  void running.syncNow();
  return running;
}

/** Stops the running runtime (used when the user disconnects the device). */
export function stopBackgroundSync(): void {
  if (running) {
    running.stop();
    running = null;
  }
}

/** Test hook. */
export function stopBackgroundSyncForTest(): void {
  stopBackgroundSync();
}

export interface UploadResult {
  /** Records the server accepted. */
  uploaded: number;
  /** Records the server already had a newer copy of; nothing was lost. */
  stale: number;
  /** How many syncable records this device held when the upload started. */
  total: number;
}

export interface UploadOptions {
  /**
   * Called after every chunk, so a first upload of a large profile can say
   * "1,200 of 3,400" instead of appearing to hang. A local database can hold
   * tens of thousands of rows.
   */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Uploads the whole local database to the server, bypassing the outbox (these
 * rows were never queued; this is the migration path, and the one the pairing
 * dialog runs when the user leaves the "also upload" box ticked).
 */
export async function uploadAllLocalRecords(
  engine: SyncEngine,
  options: UploadOptions = {},
): Promise<UploadResult> {
  return withSyncActivity(() => pushAllLocalRecords(engine, options));
}

async function pushAllLocalRecords(
  engine: SyncEngine,
  options: UploadOptions = {},
): Promise<UploadResult> {
  const records = await listLocalRecords();
  const result: UploadResult = { uploaded: 0, stale: 0, total: records.length };
  if (records.length === 0) {
    return result;
  }
  const CHUNK = 100;
  let done = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const pushed = await engine.pushRecords(records.slice(i, i + CHUNK));
    result.uploaded += pushed.results.filter((r) => r.status === 'ok').length;
    result.stale += pushed.results.filter((r) => r.status === 'stale').length;
    done += Math.min(CHUNK, records.length - i);
    if (options.onProgress) {
      options.onProgress(done, records.length);
    }
  }
  return result;
}
