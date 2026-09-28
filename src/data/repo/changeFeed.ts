/**
 * Change feed: turns local Dexie writes into outbox entries.
 *
 * The feed is driven by Dexie's own write hooks
 * (`Table.hook('creating' | 'updating' | 'deleting')`), which fire **in the
 * context that performed the write**. That is exactly what sync needs:
 * whichever page or the service worker mutated the database also drops the
 * change into the shared outbox in chrome.storage.local, and the background
 * sync engine flushes it.
 *
 * This replaced dexie-observable, whose `db.on('changes')` event also reported
 * writes made by *other* contexts through a BroadcastChannel. Nothing needs
 * that any more: every context owns the tabverses of the window it manages and
 * reports its own writes, so the addon (a beta last published in 2023) could
 * go. See ADR 0006.
 *
 * Two details worth knowing:
 *
 *  - `updating` only receives the *diff*, not the committed row, so the feed
 *    re-reads the row after the write (IndexedDB queues that read behind the
 *    write transaction, so it observes the new value). Building the payload
 *    from the diff would silently truncate any record whose `put` dropped a
 *    field.
 *  - hooks fire before the transaction commits, so an aborted transaction can
 *    leave an outbox entry for a row that was never stored. The outbox is an
 *    intent log, the entry is harmless, and the next real write replaces it.
 *
 * Writes performed while the engine is applying server records are ignored
 * (runAsRemoteApply) so a pull cannot echo straight back out as a push.
 */

import { StorageAreaLike, ChromeStorageArea } from './outbox';
import { db } from '../../storage/db';
import { entityForTable, rowUpdatedAt } from './dbBridge';
import { logger } from '../../global';
import { Outbox } from './outbox';
import { RecordInput } from './types';
import { loadSyncConfig } from './syncConfig';
import { notifyLocalTablesChanged } from './localTables';

export const WRITE_CREATE = 1;
export const WRITE_UPDATE = 2;
export const WRITE_DELETE = 3;

/** One local write, normalized so the outbox layer does not care how we saw it. */
export interface LocalWrite {
  table: string;
  type: number;
  key: string;
  /** The committed row for creates; absent for updates/deletes. */
  obj?: any;
}

let changeFeedStarted = false;
let remoteApplyDepth = 0;

/**
 * Runs `fn` while change feed suppression is active. The sync engine wraps
 * every applyServerRecords call in this.
 */
export async function runAsRemoteApply<T>(fn: () => Promise<T>): Promise<T> {
  remoteApplyDepth += 1;
  try {
    return await fn();
  } finally {
    remoteApplyDepth -= 1;
  }
}

export function isRemoteApplyActive(): boolean {
  return remoteApplyDepth > 0;
}

export interface ChangeFeedOptions {
  storage?: StorageAreaLike;
  /** Skip constructing an outbox (the engine already has one). */
  outbox?: Outbox;
  /** Test seam: the database to hook. Defaults to the app database. */
  database?: typeof db;
}

/**
 * Registers the Dexie write hooks. Idempotent; safe to call from both the
 * manager page and the background service worker. Must be awaited before the
 * first write of a context, or that write is not queued.
 */
export async function startChangeFeed(
  options: ChangeFeedOptions = {},
): Promise<void> {
  if (changeFeedStarted) {
    return;
  }
  changeFeedStarted = true;
  const storage = options.storage || new ChromeStorageArea();
  const outbox = options.outbox || new Outbox(storage);
  const database = options.database || db;

  try {
    // Table.hook() only exists once the schema has been read, which happens
    // when the database is opened.
    await database.open();

    // Writes are collected and flushed once per microtask so a bulkPut of 50
    // rows costs one config read instead of fifty.
    let pending: LocalWrite[] = [];
    let flushScheduled = false;
    const emit = (write: LocalWrite) => {
      pending.push(write);
      if (flushScheduled) {
        return;
      }
      flushScheduled = true;
      queueMicrotask(() => {
        const batch = pending;
        pending = [];
        flushScheduled = false;
        void handleChanges(batch, outbox, storage);
      });
    };

    for (const table of database.tables) {
      const name = table.name;
      table.hook('creating', (primKey, obj) => {
        const row = obj as any;
        const key = rowId(row) ?? String(primKey);
        if (!key) {
          return;
        }
        emit({ table: name, type: WRITE_CREATE, key, obj: row });
      });
      table.hook('updating', (_mods, primKey, _oldObj, transaction) => {
        const key = String(primKey);
        if (!key) {
          return;
        }
        // The hook only receives the diff, so the committed row is read back -
        // and only *after* the commit. A read issued here would join the
        // still-open write transaction (Dexie keeps it as the ambient one) and
        // return the pre-update value.
        transaction.on('complete', () => {
          void database
            .table(name)
            .get(primKey)
            .then((row) => {
              if (row) {
                emit({ table: name, type: WRITE_UPDATE, key, obj: row });
              }
            })
            .catch((err) =>
              logger.log('repo: change feed could not re-read', name, key, err),
            );
        });
      });
      table.hook('deleting', (primKey) => {
        const key = String(primKey);
        if (key) {
          emit({ table: name, type: WRITE_DELETE, key });
        }
      });
    }
    logger.log('repo: change feed started (dexie write hooks)');
  } catch (err) {
    // Environments that use the bare test database cannot hook writes - they
    // drive handleChanges() directly instead.
    changeFeedStarted = false;
    logger.log('repo: change feed unavailable, no hookable db here:', err);
  }
}

/** Test hook: lets a fresh instance be registered inside one process. */
export function resetChangeFeedForTest(): void {
  changeFeedStarted = false;
}

/**
 * Processes one batch of local writes. Exported for tests; production code
 * reaches it through the Dexie hooks registered above.
 */
export async function handleChanges(
  changes: LocalWrite[],
  outbox: Outbox,
  storage: StorageAreaLike,
): Promise<void> {
  // The UI listens for table changes even during a remote apply: the sync
  // engine writes rows on behalf of other windows/devices and the open
  // manager page has to re-read its counts and lists.
  notifyLocalTablesChanged(changes.map((change) => change.table));

  if (remoteApplyDepth > 0) {
    return;
  }
  let config;
  try {
    config = await loadSyncConfig(storage);
  } catch {
    return;
  }
  if (!config || !config.enabled) {
    return;
  }

  for (const change of changes) {
    const entity = entityForTable(change.table);
    if (!entity) {
      continue;
    }
    try {
      const input = toRecordInput(entity, change);
      if (input) {
        await outbox.enqueue(input);
      }
    } catch (err) {
      logger.log('repo: failed to queue change', change, err);
    }
  }
}

function rowId(row: any): string | null {
  return row && typeof row.id === 'string' ? row.id : null;
}

function toRecordInput(entity: string, change: LocalWrite): RecordInput | null {
  if (change.type === WRITE_CREATE || change.type === WRITE_UPDATE) {
    const row: any = change.obj;
    if (!row || typeof row.id !== 'string') {
      return null;
    }
    return {
      entity: entity as RecordInput['entity'],
      id: row.id,
      updated_at: rowUpdatedAt(row),
      deleted: false,
      payload: JSON.stringify(row),
    };
  }
  if (change.type === WRITE_DELETE) {
    if (typeof change.key !== 'string' || !change.key) {
      return null;
    }
    return {
      entity: entity as RecordInput['entity'],
      id: change.key,
      updated_at: Date.now(),
      deleted: true,
      payload: '',
    };
  }
  return null;
}
