import { IBase } from '../common';

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

export function setId(newId: string, targetTab: Tab): Tab {
  return {
    ...targetTab,
    id: newId,
  };
}

export function setTabSpaceId(tabSpaceId: string, targetTab: Tab): Tab {
  return { ...targetTab, tabSpaceId };
}

export function setTitle(title: string, targetTab: Tab): Tab {
  return { ...targetTab, title };
}

export function setUrl(url: string, targetTab: Tab): Tab {
  return { ...targetTab, url };
}

export function setFavIconUrl(favIconUrl: string, targetTab: Tab): Tab {
  return { ...targetTab, favIconUrl };
}

export function setPinned(pinned: boolean, targetTab: Tab): Tab {
  return { ...targetTab, pinned };
}

export function setSuspended(suspended: boolean, targetTab: Tab): Tab {
  return { ...targetTab, suspended };
}

export function setChromeTabId(chromeTabId: number, targetTab: Tab): Tab {
  return { ...targetTab, chromeTabId };
}

export function setChromeWindowId(chromeWindowId: number, targetTab: Tab): Tab {
  return { ...targetTab, chromeWindowId };
}

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
