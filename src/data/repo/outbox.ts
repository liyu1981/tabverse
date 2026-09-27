/**
 * Outbox: a durable mutation queue for the sync engine.
 *
 * Writes are enqueued locally first (so the UI never blocks on the network),
 * then flushed by the sync engine. Entries are keyed by (entity, id) and
 * collapsed to the newest `updated_at`, which means offline edits of the same
 * record do not pile up. Storage is injected: chrome.storage.local in the
 * extension, a plain object in tests.
 */

import { EntityName, RecordInput, RecordResult, isEntityName } from './types';

export interface OutboxEntry {
  entity: EntityName;
  id: string;
  updated_at: number;
  deleted: boolean;
  payload: string;
  attempts: number;
  last_error?: string;
}

export interface StorageAreaLike {
  get(keys: string[]): Promise<Record<string, any>>;
  set(items: Record<string, any>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export const DEFAULT_OUTBOX_KEY = 'tabverse_outbox_v1';

/** chrome.storage.local (MV3 promise form) behind the injected interface. */
export class ChromeStorageArea implements StorageAreaLike {
  get(keys: string[]): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
      (chrome.storage.local as any).get(keys, (items: Record<string, any>) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
        } else {
          resolve(items || {});
        }
      });
    });
  }

  set(items: Record<string, any>): Promise<void> {
    return new Promise((resolve, reject) => {
      (chrome.storage.local as any).set(items, () => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
        } else {
          resolve();
        }
      });
    });
  }

  remove(keys: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      (chrome.storage.local as any).remove(keys, () => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
        } else {
          resolve();
        }
      });
    });
  }
}

/** Simple in-memory storage for tests. */
export class MemoryStorageArea implements StorageAreaLike {
  private data: Record<string, any> = {};

  async get(keys: string[]): Promise<Record<string, any>> {
    const out: Record<string, any> = {};
    for (const k of keys) {
      if (k in this.data) {
        out[k] = this.data[k];
      }
    }
    return out;
  }

  async set(items: Record<string, any>): Promise<void> {
    Object.assign(this.data, items);
  }

  async remove(keys: string[]): Promise<void> {
    for (const k of keys) {
      delete this.data[k];
    }
  }
}

export type EnqueueOutcome = 'queued' | 'replaced' | 'ignored_stale';

export class Outbox {
  private readonly storage: StorageAreaLike;
  private readonly key: string;
  /** Serializes read-modify-write cycles so concurrent enqueues cannot lose data. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(storage: StorageAreaLike, key: string = DEFAULT_OUTBOX_KEY) {
    this.storage = storage;
    this.key = key;
  }

  private async read(): Promise<OutboxEntry[]> {
    const items = await this.storage.get([this.key]);
    const raw = items[this.key];
    if (!Array.isArray(raw)) {
      return [];
    }
    return (raw as OutboxEntry[]).filter(
      (e) => e && isEntityName(e.entity) && typeof e.id === 'string',
    );
  }

  private async write(entries: OutboxEntry[]): Promise<void> {
    await this.storage.set({ [this.key]: entries });
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    // keep the chain alive even when fn rejects
    this.chain = next.catch(() => undefined);
    return next;
  }

  list(): Promise<OutboxEntry[]> {
    return this.serial(() => this.read());
  }

  size(): Promise<number> {
    return this.serial(async () => (await this.read()).length);
  }

  /**
   * Queues a local change. A newer pending change for the same record wins:
   * the stale input is dropped (`ignored_stale`), the newer one is replaced
   * (`replaced`) or appended (`queued`).
   */
  enqueue(input: RecordInput): Promise<EnqueueOutcome> {
    return this.serial(async () => {
      const entries = await this.read();
      const idx = entries.findIndex(
        (e) => e.entity === input.entity && e.id === input.id,
      );
      if (idx >= 0 && entries[idx].updated_at >= input.updated_at) {
        return 'ignored_stale';
      }
      const entry: OutboxEntry = {
        entity: input.entity,
        id: input.id,
        updated_at: input.updated_at,
        deleted: !!input.deleted,
        payload: input.payload,
        attempts: 0,
      };
      if (idx >= 0) {
        entries[idx] = entry;
        await this.write(entries);
        return 'replaced';
      }
      entries.push(entry);
      await this.write(entries);
      return 'queued';
    });
  }

  /** Drops an entry after the server acknowledged it. */
  clear(entity: EntityName, id: string): Promise<void> {
    return this.serial(async () => {
      const entries = await this.read();
      await this.write(
        entries.filter((e) => !(e.entity === entity && e.id === id)),
      );
    });
  }

  /**
   * Applies a batch of server results:
   *  - status 'ok'   -> the queued change landed, drop it
   *  - status 'stale'-> the server copy is newer (LWW lost); the caller is
   *                    expected to have adopted `result.current` already, so
   *                    the local (losing) entry is dropped too.
   * Entries newer than an acknowledged `updated_at` are kept: they were
   * enqueued while the flush was in flight.
   */
  applyResults(results: RecordResult[]): Promise<void> {
    return this.serial(async () => {
      if (results.length === 0) {
        return;
      }
      const entries = await this.read();
      const acked = new Map<string, number>();
      for (const r of results) {
        const k = `${r.entity}/${r.id}`;
        acked.set(k, Math.max(acked.get(k) || 0, r.updated_at));
      }
      const kept = entries.filter((e) => {
        const ackAt = acked.get(`${e.entity}/${e.id}`);
        if (ackAt === undefined) {
          return true; // not part of this flush
        }
        return e.updated_at > ackAt;
      });
      await this.write(kept);
    });
  }

  /** Records a failed flush attempt (used for diagnostics/backoff). */
  recordFailure(entity: EntityName, id: string, error: string): Promise<void> {
    return this.serial(async () => {
      const entries = await this.read();
      const idx = entries.findIndex((e) => e.entity === entity && e.id === id);
      if (idx < 0) {
        return;
      }
      entries[idx] = {
        ...entries[idx],
        attempts: (entries[idx].attempts || 0) + 1,
        last_error: error,
      };
      await this.write(entries);
    });
  }
}
