/**
 * Change feed: turns local Dexie writes into outbox entries.
 *
 * Dexie fires its `changes` hooks in the context that performed the write,
 * which is exactly what we need: whichever page (or the service worker)
 * mutates the database also drops the change into the shared outbox in
 * chrome.storage.local; the background sync engine flushes it.
 *
 * Writes performed while the engine is applying server records are ignored
 * (flag below) so a pull cannot echo straight back out as a push.
 */

import { IDatabaseChange } from 'dexie-observable/api';

// dexie-observable's DatabaseChangeType is a const enum (1/2/3) declared in a
// types-only module; mirror the values so this file never needs a runtime
// import from it.
const CHANGE_CREATE = 1;
const CHANGE_UPDATE = 2;
const CHANGE_DELETE = 3;

import { db } from '../../storage/db';
import { logger } from '../../global';
import { Outbox, StorageAreaLike, ChromeStorageArea } from './outbox';
import { loadSyncConfig } from './syncConfig';
import { entityForTable, rowUpdatedAt } from './dbBridge';
import { RecordInput } from './types';

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
  /** Skip the "is sync configured" lookup (the engine already knows). */
  outbox?: Outbox;
}

/**
 * Registers the Dexie change hook. Idempotent; safe to call from both the
 * manager page and the background service worker.
 */
export function startChangeFeed(options: ChangeFeedOptions = {}): void {
  if (changeFeedStarted) {
    return;
  }
  changeFeedStarted = true;
  const storage = options.storage || new ChromeStorageArea();
  const outbox = options.outbox || new Outbox(storage);

  try {
    db.on('changes', (changes: IDatabaseChange[]) => {
      void handleChanges(changes, outbox, storage);
    });
    logger.log('repo: change feed started');
  } catch (err) {
    // The 'changes' event only exists once dexie-observable has been loaded
    // (dbImpl.ts does that for every real context). Environments that use
    // the bare test database cannot observe changes - they drive
    // handleChanges() directly instead.
    logger.log('repo: change feed unavailable, no observable db here:', err);
  }
}

/** Test hook: lets a fresh instance be registered inside one process. */
export function resetChangeFeedForTest(): void {
  changeFeedStarted = false;
}

/**
 * Processes one batch of Dexie changes. Exported for tests; production code
 * reaches it through the `db.on('changes')` registration above.
 */
export async function handleChanges(
  changes: IDatabaseChange[],
  outbox: Outbox,
  storage: StorageAreaLike,
): Promise<void> {
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

function toRecordInput(
  entity: string,
  change: IDatabaseChange,
): RecordInput | null {
  if (change.type === CHANGE_CREATE || change.type === CHANGE_UPDATE) {
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
  if (change.type === CHANGE_DELETE) {
    const id =
      typeof change.key === 'string'
        ? change.key
        : change.oldObj && typeof change.oldObj.id === 'string'
          ? change.oldObj.id
          : null;
    if (!id) {
      return null;
    }
    return {
      entity: entity as RecordInput['entity'],
      id,
      updated_at: Date.now(),
      deleted: true,
      payload: '',
    };
  }
  return null;
}
