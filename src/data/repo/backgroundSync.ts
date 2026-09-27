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
  // the engine's own "already syncing" guard.
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const syncNow = () => engine.syncOnce();
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
 */
export async function startBackgroundSync(
  deps: SyncRuntimeDeps = {},
): Promise<SyncRuntime | null> {
  if (running) {
    return running;
  }
  const storage = deps.storage || new ChromeStorageArea();

  const config = await loadSyncConfig(storage).catch((err) => {
    logger.log('repo: cannot read sync config:', err);
    return null;
  });
  if (!config || !config.enabled) {
    logger.log('repo: sync not configured, running local only');
    return null;
  }

  startChangeFeed({ storage });
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

/** Helper used by migration tooling: upload the whole local database. */
export async function uploadAllLocalRecords(
  engine: SyncEngine,
): Promise<number> {
  const records = await listLocalRecords();
  if (records.length === 0) {
    return 0;
  }
  const CHUNK = 100;
  let uploaded = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const result = await engine.pushRecords(records.slice(i, i + CHUNK));
    uploaded += result.results.filter((r) => r.status === 'ok').length;
  }
  return uploaded;
}
