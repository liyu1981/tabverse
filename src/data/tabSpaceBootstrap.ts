import { scanCurrentTabs, startMonitorTabChanges } from './tabSpace/chromeTab';

import { loadPreviews } from './tabSpace/tabPreviewStore';
import { monitorDbChanges, saveCurrentTabSpace } from './tabSpace/util';
import { startMonitorChromeMessage } from '../message/chromeMessage';
import { $tabSpace, tabSpaceStoreApi } from './tabSpace/store';
import { logger } from '../global';

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
  await restoreTabPreviews();
  startMonitorTabChanges();
  startMonitorChromeMessage();
  monitorDbChanges();
}

/**
 * Puts the stored thumbnails back into the in-memory cache.
 *
 * It runs on bootstrap, which is the only moment the full set of live tabs is
 * known - but that is a *restore*, not a reap. Dropping what has no tab is the
 * worker's job now (data/tabSpace/previewReaper): the sweep works on indexed
 * keys, and the manager page should not be doing that work at all before it has
 * drawn anything.
 */
async function restoreTabPreviews(): Promise<void> {
  const tabSpace = $tabSpace.getState();
  const liveChromeTabIds = tabSpace.tabs
    .map((tab) => tab.chromeTabId)
    .filter((id) => id >= 0)
    .toArray();
  if (liveChromeTabIds.length === 0) {
    return;
  }
  const stored = await loadPreviews(liveChromeTabIds);
  stored.forEach((preview, chromeTabId) => {
    tabSpaceStoreApi.setPreview({ chromeTabId, preview });
  });
  if (stored.size > 0) {
    logger.log(`restored ${stored.size} stored tab preview(s)`);
  }
}
