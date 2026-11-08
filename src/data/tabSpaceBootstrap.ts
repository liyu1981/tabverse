import { scanCurrentTabs, startMonitorTabChanges } from './tabSpace/chromeTab';
import { startSplitViewRescan } from './tabSpace/splitView';
import { startMonitorSuspendWhitelist } from './tabSpace/suspendWhitelistMonitor';

import { monitorDbChanges, saveCurrentTabSpace } from './tabSpace/util';
import { startMonitorChromeMessage } from '../message/chromeMessage';
import { tabSpaceStoreApi } from './tabSpace/store';
import { startMonitorOpenTabSpaces } from './tabSpace/openWindowStore';

/**
 * @param tabSpaceId the tabverse id from the tab's url (`tvid`). It is minted
 * when the tab is opened, so a tabverse is saved from the first moment and a
 * reload keeps the same identity.
 */
export async function tabSpaceBootstrap(
  chromeTabId: number,
  chromeWindowId: number,
  tabSpaceId: string,
): Promise<void> {
  tabSpaceStoreApi.updateTabSpace({
    id: tabSpaceId,
    chromeTabId,
    chromeWindowId,
    name: `Window-${chromeWindowId}`,
  });

  // Save right away: the record should exist before the first tab event, so a
  // crash in the first second cannot lose the tabverse.
  await saveCurrentTabSpace();

  await scanCurrentTabs();
  startMonitorTabChanges();
  // Keep the worker's suspension whitelist in step with this window: the
  // durable list is our tab ids, but the worker acts on chrome tab ids, and
  // this page is the only context that knows both at once
  // (data/tabSpace/suspendWhitelist).
  startMonitorSuspendWhitelist();
  // A split view can be closed without anything else about the tab changing, so
  // the event path is not enough on its own: ask Chrome again every minute what
  // is true, rather than waiting for an event that may never arrive
  // (splitView.ts, ADR 0022).
  startSplitViewRescan();
  // The other tabverses open in this browser, for the sidebar's list. It is a
  // page concern: only a page draws it, and the worker is asleep most of the
  // time. Started after the scan, so the first read sees a settled window.
  startMonitorOpenTabSpaces();
  startMonitorChromeMessage();
  monitorDbChanges();
}

/**
 * Thumbnails are no longer hydrated here.
 *
 * Bootstrap used to read every live tab's stored preview before the page had
 * drawn anything, into a cache with no limit: a window with many tabs
 * materialised tens of megabytes of base64 at load time for pictures that only
 * ever show on hover. The cache is bounded now (see `TabPreviewCache`), and a
 * thumbnail is read when its hover preview opens instead
 * (`tabPreviewStore.hydratePreview`), so bootstrap does nothing about previews
 * at all. Dropping what has no tab is still the worker's job, and still not
 * this page's (data/tabSpace/previewReaper).
 */
