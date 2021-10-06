import {
  SavedTabSpaceStore,
  monitorDbChanges,
  monitorTabSpaceChange,
  querySavedTabSpaceById,
} from './tabSpaceStore';
import { TabSpaceRegistryMsg, sendChromeMessage } from '../../message';
import { filter, map } from 'lodash';
import { scanCurrentTabs, startMonitorTabChanges } from './chromeTab';

import { TabPreview } from './tabPreview';
import { TabSpace } from './tabSpace';
import { TabSpaceRegistry } from './tabSpaceRegistry';
import { strict as assert } from 'assert';
import { exposeDebugData } from '../../debug';
import { getSavedStoreManager } from '../../store/bootstrap';
import { startMonitorTabSpaceRegistryChanges } from './chromeMessage';

export interface ITabSpaceData {
  tabSpace: TabSpace;
  tabSpaceRegistry: TabSpaceRegistry;
  tabPreview: TabPreview;
  savedTabSpaceStore: SavedTabSpaceStore;
}

let tabSpaceData: ITabSpaceData | null = null;

function createTabSpaceData() {
  return {
    tabSpace: new TabSpace(),
    tabSpaceRegistry: new TabSpaceRegistry(),
    tabPreview: new TabPreview(),
    savedTabSpaceStore: new SavedTabSpaceStore(),
  };
}

export function getTabSpaceData(): ITabSpaceData {
  assert(
    tabSpaceData !== null,
    'call bootstrap/bootstrapFromTabSpaceId to init tabSpaceData!',
  );
  return tabSpaceData;
}

async function bootstrapCommon(tabSpaceData: ITabSpaceData) {
  await scanCurrentTabs(tabSpaceData);
  startMonitorTabChanges(tabSpaceData);
  startMonitorTabSpaceRegistryChanges(tabSpaceData.tabSpaceRegistry);
  monitorDbChanges(tabSpaceData.savedTabSpaceStore);
  monitorTabSpaceChange(tabSpaceData);
}

export async function bootstrap(
  chromeTabId: number,
  chromeWindowId: number,
): Promise<void> {
  const { tabSpace, tabSpaceRegistry, tabPreview, savedTabSpaceStore } =
    createTabSpaceData();
  tabSpace.setChromeTabAndWindowId(chromeTabId, chromeWindowId, true);
  tabSpaceRegistry.add(tabSpace.toTabSpaceStub());

  getSavedStoreManager().addSavedStore('tabverse', savedTabSpaceStore);
  exposeDebugData('tabverse', { getTabSpaceData });

  // now we mount to our global variable
  tabSpaceData = {
    tabSpace,
    tabSpaceRegistry,
    tabPreview,
    savedTabSpaceStore,
  };

  sendChromeMessage({
    type: TabSpaceRegistryMsg.AddTabSpace,
    payload: tabSpace.toTabSpaceStub(),
  });

  await bootstrapCommon(tabSpaceData);
}

export async function bootstrapFromTabSpaceId(
  savedTabSpaceId: string,
  chromeTabId: number,
  chromeWindowId: number,
): Promise<void> {
  const localTabSpaceData = createTabSpaceData();

  localTabSpaceData.tabSpace = await querySavedTabSpaceById(savedTabSpaceId);
  localTabSpaceData.tabSpace.setChromeTabAndWindowId(
    chromeTabId,
    chromeWindowId,
  );

  const otherTabs = filter(
    await chrome.tabs.query({ currentWindow: true }),
    (tab) => tab.id !== chromeTabId,
  );
  await Promise.all(
    map(otherTabs, (otherTab) => chrome.tabs.remove(otherTab.id)),
  );

  // here we do not use map but use for loop to ensure that we restore tabs in
  // the saved order
  for (let i = 0; i < localTabSpaceData.tabSpace.tabs.size; i++) {
    const savedTab = localTabSpaceData.tabSpace.tabs.get(i);
    const updatedSavedTab = savedTab.clone();
    const chromeTab = await chrome.tabs.create({ url: savedTab.url });
    updatedSavedTab.chromeTabId = chromeTab.id;
    updatedSavedTab.chromeWindowId = chromeTab.windowId;
    localTabSpaceData.tabSpace.updateTab(updatedSavedTab);
  }

  localTabSpaceData.tabSpaceRegistry.add(
    localTabSpaceData.tabSpace.toTabSpaceStub(),
  );

  getSavedStoreManager().addSavedStore(
    'tabverse',
    localTabSpaceData.savedTabSpaceStore,
  );
  exposeDebugData('tabverse', { getTabSpaceData });

  // now we mount to our global variable
  tabSpaceData = localTabSpaceData;

  sendChromeMessage({
    type: TabSpaceRegistryMsg.AddTabSpace,
    payload: tabSpaceData.tabSpace.toTabSpaceStub(),
  });

  await bootstrapCommon(tabSpaceData);

  // focus tabspace tab
  const currentTab = await chrome.tabs.getCurrent();
  await chrome.tabs.update(currentTab.id, { active: true });
}
