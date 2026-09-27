/**
 * SyncEngine: orchestrates push (outbox flush) + pull (delta download) and
 * keeps the revision cursor.
 *
 * This replaces the extension's previous coordination machinery:
 *  - dexie-observable change broadcasts  -> server fan-out + delta pull
 *  - tabSpaceRegistry leader election    -> the server is the single writer
 *  - Dropbox whole-DB dumps              -> incremental sync
 *
 * The engine is storage agnostic: local application of server records goes
 * through injected hooks, so it can be unit tested without IndexedDB and
 * reused by both the manager page and the background service worker.
 */

import {
  ChromeStorageArea,
  Outbox,
  OutboxEntry,
  StorageAreaLike,
} from './outbox';
import { ServerApiClient, ServerApiError } from './serverApi';
import {
  EMPTY_SYNC_STATE,
  PushResult,
  RecordInput,
  SyncRecord,
  SyncState,
} from './types';

export interface SyncStateStore {
  get(): Promise<SyncState>;
  set(state: SyncState): Promise<void>;
}

const SYNC_STATE_KEY = 'tabverse_sync_state_v1';

/** chrome.storage backed cursor (works in the SW and in pages). */
export class ChromeSyncStateStore implements SyncStateStore {
  private readonly storage: StorageAreaLike;

  constructor(storage: StorageAreaLike = new ChromeStorageArea()) {
    this.storage = storage;
  }

  async get(): Promise<SyncState> {
    const items = await this.storage.get([SYNC_STATE_KEY]);
    const v = items[SYNC_STATE_KEY];
    return v && typeof v.last_rev === 'number' ? v : { ...EMPTY_SYNC_STATE };
  }

  async set(state: SyncState): Promise<void> {
    await this.storage.set({ [SYNC_STATE_KEY]: state });
  }
}

export class MemorySyncStateStore implements SyncStateStore {
  state: SyncState = { ...EMPTY_SYNC_STATE };

  async get(): Promise<SyncState> {
    return { ...this.state };
  }

  async set(state: SyncState): Promise<void> {
    this.state = { ...state };
  }
}

export interface SyncHooks {
  /** Apply server records to the local cache (upsert; tombstones included). */
  onRecords?: (records: SyncRecord[]) => void | Promise<void>;
  /**
   * LWW conflict: our queued change lost against a newer server copy.
   * `local` is what we tried to write, `current` is what the server holds.
   * If no hook is given, `current` is applied through onRecords.
   */
  onConflict?: (
    local: OutboxEntry,
    current: SyncRecord,
  ) => void | Promise<void>;
  /** Non fatal errors (401, network) for logging / re-pair UI. */
  onError?: (error: ServerApiError) => void;
}

export interface SyncOutcome {
  status: 'ok' | 'error' | 'skipped';
  pushed: number;
  stale: number;
  pulled: number;
  serverRev: number;
  cursor: number;
  error?: ServerApiError;
}

function toRecordInput(e: OutboxEntry): RecordInput {
  return {
    entity: e.entity,
    id: e.id,
    updated_at: e.updated_at,
    deleted: e.deleted,
    payload: e.payload,
  };
}

export class SyncEngine {
  private syncing = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    public readonly api: ServerApiClient,
    public readonly outbox: Outbox,
    public readonly stateStore: SyncStateStore,
    private readonly hooks: SyncHooks = {},
  ) {}

  /**
   * Pushes an arbitrary batch and applies the ack (used by the "upload my
   * local database" migration path, which does not go through the outbox).
   */
  async pushRecords(records: RecordInput[]): Promise<PushResult> {
    const result = await this.api.push(records);
    await this.outbox.applyResults(result.results);
    return result;
  }

  /**
   * One full cycle: flush the outbox, then pull every record newer than the
   * cursor. Safe to call concurrently - overlapping calls are skipped.
   */
  async syncOnce(): Promise<SyncOutcome> {
    if (this.syncing) {
      const state = await this.stateStore.get();
      return {
        status: 'skipped',
        pushed: 0,
        stale: 0,
        pulled: 0,
        serverRev: -1,
        cursor: state.last_rev,
      };
    }
    this.syncing = true;
    try {
      return await this.run();
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Full re-download from revision 0. Used on first login, after a local
   * reset, or when migrating an existing local-only database to the server.
   */
  async fullSync(): Promise<SyncOutcome> {
    await this.stateStore.set({ ...EMPTY_SYNC_STATE });
    return this.syncOnce();
  }

  private async run(): Promise<SyncOutcome> {
    let pushed = 0;
    let stale = 0;
    let pulled = 0;
    let serverRev = -1;

    let state = await this.stateStore.get();

    try {
      // 1) flush local mutations
      const entries = await this.outbox.list();
      if (entries.length > 0) {
        const byKey = new Map<string, OutboxEntry>();
        for (const e of entries) {
          byKey.set(`${e.entity}/${e.id}`, e);
        }
        const result = await this.api.push(entries.map(toRecordInput));
        serverRev = result.server_rev;
        await this.outbox.applyResults(result.results);
        for (const r of result.results) {
          if (r.status === 'ok') {
            pushed += 1;
            continue;
          }
          stale += 1;
          const local = byKey.get(`${r.entity}/${r.id}`);
          if (r.current && local) {
            if (this.hooks.onConflict) {
              await this.hooks.onConflict(local, r.current);
            } else if (this.hooks.onRecords) {
              await this.hooks.onRecords([r.current]);
            }
          }
        }
      }

      // 2) pull everything newer than the cursor (paginated)
      let hasMore = true;
      while (hasMore) {
        const page = await this.api.pull(state.last_rev);
        if (page.records.length > 0) {
          pulled += page.records.length;
          if (this.hooks.onRecords) {
            await this.hooks.onRecords(page.records);
          }
        }
        state = {
          last_rev: page.next_rev,
          last_sync_at: Date.now(),
        };
        await this.stateStore.set(state);
        serverRev = Math.max(serverRev, page.server_rev);
        hasMore = page.has_more;
      }

      return {
        status: 'ok',
        pushed,
        stale,
        pulled,
        serverRev,
        cursor: state.last_rev,
      };
    } catch (err: any) {
      const apiError =
        err instanceof ServerApiError
          ? err
          : new ServerApiError(0, 'unexpected', String(err && err.message));
      if (this.hooks.onError) {
        this.hooks.onError(apiError);
      }
      return {
        status: 'error',
        pushed,
        stale,
        pulled,
        serverRev,
        cursor: state.last_rev,
        error: apiError,
      };
    }
  }

  /** Starts periodic sync; the first run happens after `intervalMs`. */
  startAutoSync(intervalMs: number): void {
    this.stopAutoSync();
    this.timer = setInterval(() => {
      void this.syncOnce();
    }, intervalMs);
  }

  stopAutoSync(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
