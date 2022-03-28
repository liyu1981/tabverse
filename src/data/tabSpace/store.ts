import { createApi, createStore } from 'effector';
import { merge } from 'lodash';
import { exposeDebugData } from '../../debug';
import { createGeneralStorageStoreAndApi } from '../storage/store';
import { Tab } from './Tab';
import {
  newEmptyTabPreviewCache,
  removePreview,
  setPreview,
} from './TabPreviewCache';
import {
  addTabs,
  insertTab,
  newEmptyTabSpace,
  removeTabByChromeTabId,
  replaceAllTabs,
  replaceTab,
  reset,
  setName,
  TabSpace,
  updateTab,
  updateTabSpace,
} from './TabSpace';
import { querySavedTabSpaceCount } from './util';

export const $tabSpace = createStore(newEmptyTabSpace());
export type TabSpaceStore = typeof $tabSpace;

const tabSpaceApi = createApi($tabSpace, {
  update: (lastTabSpace, updatedTabSpace: TabSpace) => updatedTabSpace,
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
  reset: (
    lastTabSpace,
    withData: { chromeTabId?: number; chromeWindowId?: number; newId?: string },
  ) => reset(withData, lastTabSpace),
});

export const $tabSpacePreviewCache = createStore(newEmptyTabPreviewCache());
export type TabSpacePreviewCacheStore = typeof $tabSpacePreviewCache;

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
export type TabSpaceStorage = typeof $tabSpaceStorageStore;

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
