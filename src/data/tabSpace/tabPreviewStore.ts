/**
 * Persistence for tab thumbnails.
 *
 * Why a table of its own: a thumbnail is a base64 JPEG data URL of roughly
 * 30-80 kB, it is *local only* (it is a picture of the user's screen, and it is
 * deliberately not part of the synced `tab` record - see toTabCore), and it is
 * keyed by a chrome tab id, which is worthless outside the browser session.
 * So it must not travel to the server, and it must not bloat the tabverse
 * rows it is shown next to.
 *
 * The in-memory cache ($tabSpacePreviewCache) stays exactly as it was: it is
 * what the UI reads synchronously, and this module only keeps the durable copy
 * so a reload does not throw the thumbnails away.
 *
 * Note the identity choice: rows are keyed by chromeTabId, exactly like the
 * in-memory cache. That means a preview survives a page reload, but not a
 * browser restart or a tabverse restore (both mint new tab ids). Keying by url
 * would outlive both, at the cost of sharing one picture between two tabs on
 * the same page and going stale on every single-page-app navigation.
 */

import { db } from '../../storage/db';
import { logger } from '../../global';
import { currentPreviewSessionId } from './previewSession';
import {
  TAB_PREVIEW_DB_SCHEMA,
  TAB_PREVIEW_DB_TABLE_NAME,
} from './tabPreviewSchema';

export { TAB_PREVIEW_DB_SCHEMA, TAB_PREVIEW_DB_TABLE_NAME };

export interface TabPreviewRow {
  /** the chrome tab id, as a string: the primary key of this table */
  id: string;
  capturedAt: number;
  /**
   * The browser run that captured it (see ./previewSession). A chrome tab id
   * is only meaningful within one run and is recycled between them, so this is
   * what says "the same tab" rather than "a tab with that number".
   */
  sessionId: string;
  /** the base64 JPEG data URL from chrome.tabs.captureVisibleTab */
  preview: string;
}

const table = () => db.table<TabPreviewRow>(TAB_PREVIEW_DB_TABLE_NAME);

function key(chromeTabId: number): string {
  return String(chromeTabId);
}

/**
 * Writes (or replaces) the thumbnail of a tab. Never throws: a failed preview
 * write must not take the capture path down with it.
 */
export async function persistPreview(
  chromeTabId: number,
  preview: string,
): Promise<void> {
  try {
    await table().put({
      id: key(chromeTabId),
      capturedAt: Date.now(),
      sessionId: await currentPreviewSessionId(),
      preview,
    });
  } catch (err) {
    logger.log('repo: could not store the tab preview', chromeTabId, err);
  }
}

/** Drops the thumbnail of a tab (closed or moved out of the window). */
export async function forgetPreview(chromeTabId: number): Promise<void> {
  try {
    await table().delete(key(chromeTabId));
  } catch (err) {
    logger.log('repo: could not drop the tab preview', chromeTabId, err);
  }
}

/**
 * Reads the stored thumbnails for the given tabs, for hydrating the in-memory
 * cache on load. Returns a map keyed by chrome tab id; unknown ids are simply
 * absent, and a missing or unreadable table yields an empty map rather than an
 * error (a profile mid-upgrade, or a test database without the table).
 */
export async function loadPreviews(
  chromeTabIds: number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (chromeTabIds.length === 0) {
    return out;
  }
  try {
    // Only this browser run's rows. A row from a previous run whose chrome tab
    // id has since been recycled would otherwise be shown on a completely
    // different page - and the reaper, which drops those rows, may not have
    // woken up yet (see ./previewReaper).
    const sessionId = await currentPreviewSessionId();
    const wanted = new Set(chromeTabIds.map(key));
    const rows = await table()
      .where('sessionId')
      .equals(sessionId)
      .and((row) => wanted.has(row.id))
      .toArray()
      .catch(() => [] as TabPreviewRow[]);
    rows.forEach((row) => {
      if (row && typeof row.preview === 'string') {
        out.set(Number(row.id), row.preview);
      }
    });
  } catch (err) {
    logger.log('repo: could not read the stored tab previews', err);
  }
  return out;
}
