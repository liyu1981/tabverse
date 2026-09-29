import {
  TabGroupHint,
  TabSpace,
  addTabs,
  insertTab,
  newEmptyTabSpace,
  removeTabByChromeTabId,
  replaceAllTabs,
  replaceTab,
  reset,
  setName,
  setTabGroups,
  updateTab,
  updateTabSpace,
} from './TabSpace';
import { createApi, createStore, forward } from 'effector';
import {
  newEmptyTabPreviewCache,
  removePreview,
  setPreview,
} from './TabPreviewCache';

import { Tab } from './Tab';
import { createGeneralStorageStoreAndApi } from '../../storage/GeneralStorage';
import { exposeDebugData } from '../../debug';
import { TABSPACE_DB_TABLE_NAME } from './TabSpace';
import { db } from '../../storage/db';
import { merge } from 'lodash';
import { storageOverviewApi } from '../../storage/StorageOverview';

export const $tabSpace = createStore(newEmptyTabSpace());

const tabSpaceApi = createApi($tabSpace, {
  update: (_lastTabSpace, updatedTabSpace: TabSpace) => updatedTabSpace,
  addTab: (lastTabSpace, tab: Tab) => insertTab({ tab }, lastTabSpace),
  addTabs: (lastTabSpace, tabs: Tab[]) => addTabs(tabs, lastTabSpace),
  updateTab: (
    lastTabSpace,
    { tid, changes }: { tid: string; changes: Partial<Tab> },
  ) => updateTab({ tid, changes }, lastTabSpace),
  replaceTab: (lastTabSpace, { tid, tab }: { tid: string; tab: Tab }) =>
    replaceTab({ tid, tab }, lastTabSpace),
  replaceAllTabs: (lastTabSpace, tabs: Tab[]) =>
    replaceAllTabs(tabs, lastTabSpace),
  removeTabByChromeTabId: (lastTabSpace, chromeTabId: number) =>
    removeTabByChromeTabId(chromeTabId, lastTabSpace),
  updateTabSpace: (lastTabSpace, changes: Partial<Omit<TabSpace, 'tabIds'>>) =>
    updateTabSpace(changes, lastTabSpace),
  setName: (lastTabSpace, name: string) => setName(name, lastTabSpace),
  setTabGroups: (lastTabSpace, groups: TabGroupHint[]) =>
    setTabGroups(groups, lastTabSpace),
  reset: (
    lastTabSpace,
    withData: { chromeTabId?: number; chromeWindowId?: number; newId?: string },
  ) => reset(withData, lastTabSpace),
});

export const $tabSpacePreviewCache = createStore(newEmptyTabPreviewCache());

const tabSpacePreviewCacheApi = createApi($tabSpacePreviewCache, {
  setPreview: (
    lastTabSpacePreviewCache,
    { chromeTabId, preview }: { chromeTabId: number; preview: string },
  ) => setPreview(chromeTabId, preview, lastTabSpacePreviewCache),
  removePreview: (lastTabSpacePreviewCache, chromeTabId: number) =>
    removePreview(chromeTabId, lastTabSpacePreviewCache),
});

const { $store: $tabSpaceStorageStore, api: tabSpaceStorageApi } =
  createGeneralStorageStoreAndApi();
export const $tabSpaceStorage = $tabSpaceStorageStore;

forward({
  from: $tabSpaceStorage,
  to: storageOverviewApi.updateTabSpaceStorage,
});

/**
 * How many tabverses are stored.
 *
 * It lives here, not in util.ts, because util.ts imports this module: a count
 * query that both need used to be the third copy of itself and the reason the
 * two modules imported each other.
 */
export async function querySavedTabSpaceCount(): Promise<number> {
  return db.table(TABSPACE_DB_TABLE_NAME).count();
}

async function reQuerySavedTabSpaceCount() {
  const count = await querySavedTabSpaceCount();
  tabSpaceStorageApi.updateTotalSavedCount(count);
}

export const tabSpaceStoreApi = merge(
  tabSpaceApi,
  tabSpacePreviewCacheApi,
  tabSpaceStorageApi,
  {
    reQuerySavedTabSpaceCount,
  },
);

exposeDebugData('tabSpace', {
  $tabSpace,
  $tabSpacePreviewCache,
  $tabSpaceStorage,
  tabSpaceStoreApi,
});
