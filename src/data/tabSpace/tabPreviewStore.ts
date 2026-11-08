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
import { TAB_PREVIEW_DB_TABLE_NAME } from './tabPreviewSchema';
import { $tabSpacePreviewCache, tabSpaceStoreApi } from './store';
import { getPreview } from './TabPreviewCache';

export { TAB_PREVIEW_DB_TABLE_NAME };

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
 * The stored thumbnail of one tab, or null. One primary-key read, so the cost
 * of asking is the one row and not the table.
 *
 * Only this browser run's row is answerable. A row from a previous run whose
 * chrome tab id has since been recycled would otherwise be shown on a
 * completely different page - and the reaper, which drops those rows, may not
 * have woken up yet (see ./previewReaper). A missing or unreadable table is
 * "no thumbnail", not an error (a profile mid-upgrade, a cleaned profile).
 */
export async function loadPreview(chromeTabId: number): Promise<string | null> {
  if (chromeTabId <= 0) {
    return null;
  }
  try {
    const sessionId = await currentPreviewSessionId();
    const row = await table().get(key(chromeTabId));
    if (!row || row.sessionId !== sessionId) {
      return null;
    }
    return typeof row.preview === 'string' ? row.preview : null;
  } catch (err) {
    logger.log('repo: could not read the stored tab preview', chromeTabId, err);
    return null;
  }
}

/**
 * Reads the stored thumbnails for the given tabs. Returns a map keyed by chrome
 * tab id; unknown ids are simply absent.
 *
 * One `loadPreview` per id: the page hydrates a thumbnail at a time now (on the
 * way into a hover preview), so a batch read is not on any production path -
 * this exists for callers that want a set, and it is deliberately not the old
 * `where('sessionId').equals(...).and(...).toArray()`, which deserialised every
 * row of the run (previews included) to answer for a handful of ids.
 */
export async function loadPreviews(
  chromeTabIds: number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (const chromeTabId of chromeTabIds) {
    const preview = await loadPreview(chromeTabId);
    if (preview !== null) {
      out.set(chromeTabId, preview);
    }
  }
  return out;
}

/**
 * Puts a tab's stored thumbnail back into the in-memory cache - how a picture
 * that is no longer hot gets shown again.
 *
 * The page used to load every live tab's row at bootstrap, into an unbounded
 * cache: with a window of many tabs that is tens of megabytes of base64 read
 * and materialised before anything was drawn, for pictures that only ever show
 * on hover. The cache is bounded now (see `TabPreviewCache`), so a thumbnail
 * is read when somebody actually asks for it - on the way into the hover
 * preview - and at most one row is deserialised for it.
 *
 * No cache entry is a miss, not a re-read on a loop: the caller is the hover
 * path, so a second hover simply asks again. Never throws (the store read is
 * best effort already).
 */
export async function hydratePreview(chromeTabId: number): Promise<void> {
  if (chromeTabId <= 0) {
    return;
  }
  if (getPreview(chromeTabId, $tabSpacePreviewCache.getState()) !== '') {
    return;
  }
  const preview = await loadPreview(chromeTabId);
  if (!preview) {
    return;
  }
  if (getPreview(chromeTabId, $tabSpacePreviewCache.getState()) !== '') {
    // a capture landed while the read was in flight; the newer picture wins
    return;
  }
  tabSpaceStoreApi.setPreview({ chromeTabId, preview });
}
