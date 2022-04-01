import { startMonitorChromeMessage } from '../message/chromeMessage';
import { scanCurrentTabs, startMonitorTabChanges } from './tabSpace/chromeTab';
import { tabSpaceStoreApi } from './tabSpace/store';
import { monitorDbChanges, monitorTabSpaceChanges } from './tabSpace/util';

export async function tabSpaceBootstrap(
  chromeTabId: number,
  chromeWindowId: number,
): Promise<void> {
  tabSpaceStoreApi.updateTabSpace({
    chromeTabId,
    chromeWindowId,
    name: `Window-${chromeWindowId}`,
  });

  // getSavedStoreManager().addSavedStore('tabverse', );

  await scanCurrentTabs();
  startMonitorTabChanges();
  startMonitorChromeMessage();
  monitorDbChanges();
  monitorTabSpaceChanges();
}
