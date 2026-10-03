/**
 * What a tabverse looks like right now, for the sidebar's hover preview.
 *
 * The source is `chrome.tabs.query({ windowId })` and not the tabverse's saved
 * rows, because a preview is a claim about the window *now* and only the live
 * query can keep it: it carries the tab strip's order (which is the tabverse's
 * order by construction - restoring puts the strip back into it), `pinned`, and
 * the `chromeTabId` a thumbnail would need. The saved rows are the answer to a
 * different question ("what would be restored"), they can be a save-debounce
 * behind, and they deliberately carry no session-scoped ids (adr/0006).
 *
 * One read per hover, on a pointer that has already come to rest after a second,
 * over a window's worth of tabs. The last read is kept so that hovering away and
 * back does not query twice.
 */

import { isTabSpaceManagerPage, logger } from '../../global';

/** How many tabs the panel lists before it says how many more there are. */
export const PREVIEW_TAB_LIMIT = 4;

export interface PreviewTab {
  chromeTabId: number;
  title: string;
  url: string;
  favIconUrl: string;
  pinned: boolean;
}

export interface TabversePreview {
  windowId: number;
  /** Every tab in the window, not just the ones listed. */
  tabCount: number;
  /** The first `limit` of them, in strip order. */
  tabs: PreviewTab[];
  readAt: number;
}

/** The tabverse's own Tabverse tab is not one of its tabs (scanCurrentTabs skips it). */
function isPreviewTab(tab: chrome.tabs.Tab): boolean {
  return !isTabSpaceManagerPage(tab);
}

/**
 * A window's tabs as the panel draws them: no manager page, strip order kept,
 * capped.
 *
 * Pure, so the chrome mock's tabs are the fixtures.
 */
export function previewTabsOfWindow(
  tabs: chrome.tabs.Tab[],
  limit: number = PREVIEW_TAB_LIMIT,
): PreviewTab[] {
  return tabs
    .filter(isPreviewTab)
    .slice(0, limit)
    .map((tab) => ({
      chromeTabId: tab.id ?? -1,
      // a tab Chrome has not titled yet would otherwise draw a blank row
      title: tab.title && tab.title.length > 0 ? tab.title : (tab.url ?? ''),
      url: tab.url ?? '',
      favIconUrl: tab.favIconUrl ?? '',
      pinned: tab.pinned === true,
    }));
}

/** windowId -> the last read, so a second hover costs nothing. */
const lastRead = new Map<number, TabversePreview>();

/** The last read of a window, if this page has made one. */
export function lastPreviewOfWindow(
  windowId: number,
): TabversePreview | undefined {
  return lastRead.get(windowId);
}

/** Forgets every window's last read (the tests; and a window that went away). */
export function clearTabversePreviewCache(): void {
  lastRead.clear();
}

/**
 * Reads a window's tabs for the panel.
 *
 * A window that cannot be read - closed between the row being drawn and the
 * hover landing - is an empty preview, not an exception: the panel says the
 * tabverse has no tabs, which is the truth at that moment.
 */
export async function readTabversePreview(
  windowId: number,
  limit: number = PREVIEW_TAB_LIMIT,
): Promise<TabversePreview> {
  try {
    const tabs = await chrome.tabs.query({ windowId });
    const preview: TabversePreview = {
      windowId,
      tabCount: tabs.filter(isPreviewTab).length,
      tabs: previewTabsOfWindow(tabs, limit),
      readAt: Date.now(),
    };
    lastRead.set(windowId, preview);
    return preview;
  } catch (err) {
    logger.log('could not read the tabs of window', windowId, err);
    const preview: TabversePreview = {
      windowId,
      tabCount: 0,
      tabs: [],
      readAt: Date.now(),
    };
    lastRead.set(windowId, preview);
    return preview;
  }
}
