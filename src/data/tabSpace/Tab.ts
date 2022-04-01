import { IBase, setAttrForObject2 } from '../common';
import { convertToSavedBase, newEmptyBase, toBase } from '../Base';

import { NotTabSpaceId } from '../chromeSession/ChromeSession';

export interface TabCore extends IBase {
  tabSpaceId: string;
  title: string;
  url: string;
  favIconUrl: string;
  pinned: boolean;
  suspended: boolean;
}

export interface LiveTab {
  chromeTabId: number;
  chromeWindowId: number;
}

export type Tab = TabCore & LiveTab;
export type TabSavePayload = TabCore;

export const TAB_DB_TABLE_NAME = 'SavedTab';
export const TAB_DB_SCHEMA = 'id, title, url, createdAt';

export function newEmptyTab(): Tab {
  return {
    ...newEmptyBase(),
    tabSpaceId: NotTabSpaceId,
    title: '',
    url: '',
    favIconUrl: '',
    pinned: false,
    suspended: false,
    chromeTabId: -1,
    chromeWindowId: -1,
  };
}

export function cloneTab(targetTab: Tab): Tab {
  return { ...targetTab };
}

export const setId = setAttrForObject2<string, Tab>('id');
export const setTabSpaceId = setAttrForObject2<string, Tab>('tabSpaceId');
export const setTitle = setAttrForObject2<string, Tab>('title');
export const setUrl = setAttrForObject2<string, Tab>('url');
export const setFavIconUrl = setAttrForObject2<string, Tab>('favIconUrl');
export const setPinned = setAttrForObject2<boolean, Tab>('pinned');
export const setSuspended = setAttrForObject2<boolean, Tab>('suspended');
export const setChromeTabId = setAttrForObject2<number, Tab>('chromeTabId');
export const setChromeWindowId = setAttrForObject2<number, Tab>(
  'chromeWindowId',
);

export function fromSavedTab(savedTab: TabSavePayload): Tab {
  return { ...newEmptyTab(), ...savedTab };
}

export function fromLiveTab(liveTab: LiveTab): Tab {
  return { ...newEmptyTab(), ...liveTab };
}

export function toTabCore(targetTab: Tab): TabCore {
  return {
    ...toBase(targetTab),
    tabSpaceId: targetTab.tabSpaceId,
    title: targetTab.title,
    url: targetTab.url,
    favIconUrl: targetTab.favIconUrl,
    pinned: targetTab.pinned,
    suspended: targetTab.suspended,
  };
}

export function toLiveTab(targetTab: Tab): LiveTab {
  return {
    chromeTabId: targetTab.chromeTabId,
    chromeWindowId: targetTab.chromeWindowId,
  };
}

export function convertAndGetTabSavePayload(
  targetTab: Tab,
  savedTabSpaceId: string,
): {
  tab: Tab;
  savedTab: TabSavePayload;
} {
  const tab = {
    ...targetTab,
    ...convertToSavedBase(targetTab),
    tabSpaceId: savedTabSpaceId,
  };
  const savedTab = {
    ...toTabCore(targetTab),
    ...convertToSavedBase(targetTab),
    tabSpaceId: savedTabSpaceId,
  };
  return { tab, savedTab };
}
