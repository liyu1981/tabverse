import { monitorDbChanges, monitorTabSpaceChanges } from './tabSpace/util';
import { scanCurrentTabs, startMonitorTabChanges } from './tabSpace/chromeTab';

import { startMonitorChromeMessage } from '../message/chromeMessage';
import { tabSpaceStoreApi } from './tabSpace/store';

export async function tabSpaceBootstrap(
  chromeTabId: number,
  chromeWindowId: number,
): Promise<void> {
  tabSpaceStoreApi.updateTabSpace({
    chromeTabId,
    chromeWindowId,
    name: `Window-${chromeWindowId}`,
  });

  await scanCurrentTabs();
  startMonitorTabChanges();
  startMonitorChromeMessage();
  monitorDbChanges();
  monitorTabSpaceChanges();
}
