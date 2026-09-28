import { scanCurrentTabs, startMonitorTabChanges } from './tabSpace/chromeTab';

import { monitorDbChanges, saveCurrentTabSpace } from './tabSpace/util';
import { startMonitorChromeMessage } from '../message/chromeMessage';
import { tabSpaceStoreApi } from './tabSpace/store';

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
  startMonitorChromeMessage();
  monitorDbChanges();
}
