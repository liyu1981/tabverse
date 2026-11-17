import { shortcutStoreApi } from './store';
import {
  SHORTCUT_DB_TABLE_NAME,
  Shortcut,
  normalizeShortcutUrl,
} from './Shortcut';
import { TabSpaceDBMsg, subscribePubSubMessage } from '../../message/message';
import { db } from '../../storage/db';
import { logger } from '../../global';

/** The shortcuts in the table, or [] when it cannot be read. */
export async function queryShortcuts(): Promise<Shortcut[]> {
  try {
    return await db.table<Shortcut>(SHORTCUT_DB_TABLE_NAME).toArray();
  } catch (err) {
    logger.log('shortcut: could not read the shortcuts', err);
    return [];
  }
}

/**
 * Replaces the store with what the table holds.
 *
 * Called at manager bootstrap (the add buttons' saved state) and whenever
 * another context changes the table. Never throws: a launchpad that cannot
 * read one row is better than a page that fails to bootstrap.
 */
export async function loadShortcuts(): Promise<void> {
  shortcutStoreApi.update(await queryShortcuts());
}

/** The saved shortcut for a url, if there is one. */
export async function findShortcutByUrl(url: string): Promise<Shortcut | null> {
  const normalized = normalizeShortcutUrl(url);
  if (normalized.length <= 0) {
    return null;
  }
  try {
    const rows = await db
      .table<Shortcut>(SHORTCUT_DB_TABLE_NAME)
      .where('url')
      .equals(normalized)
      .toArray();
    return rows.length > 0 ? rows[0] : null;
  } catch (err) {
    logger.log('shortcut: could not look up the shortcut for', normalized, err);
    return null;
  }
}

/** Writes (or replaces) one shortcut and keeps the page's store in step. */
export async function saveShortcut(shortcut: Shortcut): Promise<Shortcut> {
  await db.table<Shortcut>(SHORTCUT_DB_TABLE_NAME).put(shortcut);
  shortcutStoreApi.upsert(shortcut);
  return shortcut;
}

/** Deletes one shortcut; the change feed turns the delete into a tombstone. */
export async function deleteShortcut(id: string): Promise<void> {
  await db.table<Shortcut>(SHORTCUT_DB_TABLE_NAME).delete(id);
  shortcutStoreApi.remove(id);
}

let monitorStarted = false;

/**
 * Re-reads the list when the table changes in another context.
 *
 * The service worker writes the rows a pull brought in, and a second manager
 * window writes its own; neither is visible to this page's store until it is
 * told. The write path already updated the store, so a local edit's notice
 * costs one small read and changes nothing.
 */
export function startMonitorShortcutChanges(): void {
  if (monitorStarted) {
    return;
  }
  monitorStarted = true;
  subscribePubSubMessage(
    TabSpaceDBMsg.Changed,
    (_message, changedTables: string[]) => {
      if (!changedTables.includes(SHORTCUT_DB_TABLE_NAME)) {
        return;
      }
      void loadShortcuts();
    },
  );
}

/** Test hook: the PubSub subscription is module state. */
export function resetShortcutMonitorForTest(): void {
  monitorStarted = false;
}
