/**
 * The reaper for the tab preview table - the only thing that deletes from it.
 *
 * The table is a cache (see tabPreviewStore): a thumbnail is a picture of a
 * live Chrome tab, it is worth nothing once that tab is gone, and nothing in
 * the product depends on one existing. That is what makes it safe to delete
 * rows on a timer, and it is why this runs in the service worker rather than in
 * the manager page: the page's bootstrap used to `toArray()` the whole table,
 * which is up to ~8 MB of base64 materialised in the UI's heap before it had
 * drawn anything.
 *
 * A row is unowned when any of three things is true:
 *
 *  1. **an earlier browser run wrote it** - `sessionId` differs from the
 *     current one. This is what makes rule 2 mean *the same tab*: chrome tab
 *     ids are session-scoped and recycled, so after a restart a stale row's id
 *     can belong to a completely different live page. Rows written before the
 *     session id existed (no index entry) count as unowned too.
 *  2. **no tab is open under that id** - the tab was closed, or its tabverse
 *     was restored into another window and got new ids. The lookup is *every*
 *     tab in *every* window of the profile, which is why this can run from a
 *     context that knows nothing about any tabverse. (The version of this that
 *     ran in the manager page used that one window's tabs, and a second
 *     tabverse window deleted the first one's thumbnails.)
 *  3. **the table is over `MAX_STORED_PREVIEWS`** - oldest first.
 *
 * Two rules the implementation holds to, because both were cheap to get wrong:
 *
 *  - **It never reads a `preview`.** Every step works on primary keys and
 *    indexed fields and deletes by key, so deciding to drop an 80 kB image
 *    never costs 80 kB of deserialisation - here or in the page.
 *  - **It is a cache sweep, so it never throws.** A missing table, an
 *    unreadable row, a `chrome.tabs` that will not answer: all of them log and
 *    return a report.
 */

import { logger } from '../../global';
import { db } from '../../storage/db';
import { MAX_STORED_PREVIEWS } from './tabPreviewSchema';
import { currentPreviewSessionId } from './previewSession';
import { TabPreviewRow, TAB_PREVIEW_DB_TABLE_NAME } from './tabPreviewStore';

export interface ReapReport {
  /** rows the table held when the reap started */
  scanned: number;
  dropped: {
    /** written by an earlier browser run, or before sessions existed */
    staleSession: number;
    /** no currently open tab has this id */
    unowned: number;
    /** over the cap, oldest first */
    overCap: number;
  };
  /** dropped.staleSession + dropped.unowned + dropped.overCap */
  total: number;
}

export interface ReapOptions {
  /**
   * The ids of every open tab, in every window. Injected by the tests; in
   * production it is one `chrome.tabs.query({})`.
   */
  liveTabIds?: number[];
}

const table = () => db.table<TabPreviewRow>(TAB_PREVIEW_DB_TABLE_NAME);

async function liveTabIdsOfBrowser(): Promise<number[]> {
  const tabs = await chrome.tabs.query({});
  return tabs
    .map((tab) => tab.id)
    .filter((id): id is number => typeof id === 'number');
}

function emptyReport(): ReapReport {
  return {
    scanned: 0,
    dropped: { staleSession: 0, unowned: 0, overCap: 0 },
    total: 0,
  };
}

/**
 * Drops every thumbnail that is not owned by a tab that is open right now, and
 * enforces the cap. Returns what it did; see `ReapReport`.
 */
export async function reapPreviews(
  options: ReapOptions = {},
): Promise<ReapReport> {
  const report = emptyReport();
  try {
    const sessionId = await currentPreviewSessionId();
    const allKeys = (await table().toCollection().primaryKeys()).map(String);
    if (allKeys.length === 0) {
      return report;
    }
    report.scanned = allKeys.length;

    // Rows with a session id, and the ones this run wrote. Indexed lookups
    // only: `index(...).toCollection().primaryKeys()` returns the *primary*
    // keys of the index entries, never the rows themselves.
    const withSession = new Set(
      // every row the session index knows about; rows written before the id
      // existed have no entry here, which is how they are spotted
      (await table().orderBy('sessionId').primaryKeys()).map(String),
    );
    const mine = new Set(
      (await table().where('sessionId').equals(sessionId).primaryKeys()).map(
        String,
      ),
    );

    const doomed = new Set<string>();
    for (const id of allKeys) {
      // no session id at all: written by a build that predates it
      if (!withSession.has(id) || !mine.has(id)) {
        doomed.add(id);
      }
    }
    report.dropped.staleSession = doomed.size;

    // Rule 2: a currently open tab, in any window.
    const liveTabIds = options.liveTabIds ?? (await liveTabIdsOfBrowser());
    const live = new Set(liveTabIds.map(String));
    const survivors = allKeys.filter((id) => !doomed.has(id));
    for (const id of survivors) {
      if (!live.has(id)) {
        doomed.add(id);
      }
    }
    report.dropped.unowned = doomed.size - report.dropped.staleSession;

    // Rule 3: the cap, oldest first, over what is left. The index on
    // capturedAt gives the order without reading a single row.
    const kept = survivors.filter((id) => !doomed.has(id));
    if (kept.length > MAX_STORED_PREVIEWS) {
      const keptSet = new Set(kept);
      const byAge = (await table().orderBy('capturedAt').primaryKeys()).map(
        String,
      );
      const overflow = kept.length - MAX_STORED_PREVIEWS;
      let dropped = 0;
      for (const id of byAge) {
        if (dropped >= overflow) {
          break;
        }
        if (keptSet.has(id)) {
          doomed.add(id);
          dropped += 1;
        }
      }
      report.dropped.overCap = dropped;
    }

    if (doomed.size > 0) {
      await table().bulkDelete(Array.from(doomed));
    }
    report.total = doomed.size;
    return report;
  } catch (err) {
    // A cache sweep that throws would take the worker's alarm down with it, and
    // the next run would be five minutes later. Losing a few megabytes is not
    // worth an error path here.
    logger.log('repo: could not reap the tab previews', err);
    return report;
  }
}

/** One line for the log, or null when there was nothing to do. */
export function describeReap(report: ReapReport): string | null {
  if (report.scanned === 0) {
    return null;
  }
  return (
    `tab preview reap: ${report.scanned} row(s), dropped ${report.total} ` +
    `(${report.dropped.staleSession} from an earlier session, ` +
    `${report.dropped.unowned} with no open tab, ` +
    `${report.dropped.overCap} over the cap of ${MAX_STORED_PREVIEWS})`
  );
}
