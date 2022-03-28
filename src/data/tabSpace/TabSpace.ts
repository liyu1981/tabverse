import { List } from 'immutable';
import { eq, omit } from 'lodash';
import { convertToSavedBase, newEmptyBase, toBase } from '../Base';
import { getSavedId, getUnsavedNewId, IBase, isIdNotSaved } from '../common';
import {
  convertAndGetTabSavePayload,
  TabCore,
  setTabSpaceId,
  Tab,
} from './Tab';
import { TabSpaceStub } from '../tabSpaceRegistry/TabSpaceRegistry';
import { hasOwnProperty } from '../../global';

export interface LiveTabSpace {
  chromeTabId: number;
  chromeWindowId: number;
}

export interface TabSpaceCore extends IBase {
  name: string;
  tabs: List<Tab>;
}

export type TabSpace = TabSpaceCore & LiveTabSpace;

export interface TabSpaceSavePayload extends IBase {
  name: string;
  tabIds: string[];
}

export const TABSPACE_DB_TABLE_NAME = 'SavedTabSpace';
export const TABSPACE_DB_SCHEMA = 'id, name, *tabIds, windowId, createdAt';

export function newEmptyTabSpace(): TabSpace {
  return {
    ...newEmptyBase(),
    name: '',
    tabs: List<Tab>(),
    chromeTabId: -1,
    chromeWindowId: -1,
  };
}

export function cloneTabSpace(targetTabSpace: TabSpace): TabSpace {
  return { ...targetTabSpace, tabs: List(targetTabSpace.tabs) };
}

export function updateTabSpace(
  changes: Partial<Omit<TabSpace, 'tabIds'>>,
  targetTabSpace: TabSpace,
): TabSpace {
  if (hasOwnProperty(changes, 'tabIds')) {
    return cloneTabSpace(targetTabSpace);
  } else {
    return { ...targetTabSpace, ...changes };
  }
}

export function setId(id: string, targetTabSpace: TabSpace): TabSpace {
  return { ...targetTabSpace, id };
}

export function setName(name: string, targetTabSpace: TabSpace): TabSpace {
  return { ...targetTabSpace, name };
}

export function setChromeTabId(
  chromeTabId: number,
  targetTabSpace: TabSpace,
): TabSpace {
  return { ...targetTabSpace, chromeTabId };
}

export function setChromeWindowId(
  chromeWindowId: number,
  targetTabSpace: TabSpace,
): TabSpace {
  return { ...targetTabSpace, chromeWindowId };
}

export function getTabIds(targetTabSpace: TabSpace): string[] {
  return targetTabSpace.tabs.map((tab) => tab.id).toArray();
}

export function needAutoSave(targetTabSpace: TabSpace): boolean {
  return !isIdNotSaved(targetTabSpace.id);
}

export function isEqual(t1: TabSpace, t2: TabSpace): boolean {
  return (
    eq(omit(t1, 'tabs'), omit(t2, 'tabs')) &&
    eq(t1.tabs.toArray(), t2.tabs.toArray())
  );
}

export function fromSavedDataWithoutTabs(d: TabSpaceSavePayload): TabSpace {
  return { ...newEmptyTabSpace(), ...omit(d, 'tabIds') };
}

export function reset(
  {
    chromeTabId,
    chromeWindowId,
    newId,
  }: { chromeTabId?: number; chromeWindowId?: number; newId?: string },
  targetTabSpace: TabSpace,
): TabSpace {
  return {
    ...targetTabSpace,
    chromeTabId: chromeTabId ?? -1,
    chromeWindowId: chromeWindowId ?? -1,
    id: newId ?? getUnsavedNewId(),
    tabs: List(),
  };
}

export function findTabById(
  id: string,
  targetTabSpace: TabSpace,
): Tab | undefined {
  return targetTabSpace.tabs.find((tab) => tab.id === id);
}

export function findTabByChromeTabId(
  id: number,
  targetTabSpace: TabSpace,
): Tab | undefined {
  return targetTabSpace.tabs.find((tab) => tab.chromeTabId === id);
}

export function insertTab(
  { tab, index }: { tab: Tab; index?: number },
  targetTabSpace: TabSpace,
): TabSpace {
  const newTab = setTabSpaceId(targetTabSpace.id, tab);
  let newTabs = List<Tab>();
  if (index && index >= 0 && index < targetTabSpace.tabs.size) {
    newTabs = targetTabSpace.tabs.insert(index, newTab);
  } else if (index && index < 0) {
    newTabs = targetTabSpace.tabs.insert(0, newTab);
  } else if (index && index >= targetTabSpace.tabs.size) {
    newTabs = targetTabSpace.tabs.push(newTab);
  } else {
    newTabs = targetTabSpace.tabs.push(newTab);
  }
  return { ...targetTabSpace, tabs: newTabs };
}

export function addTabs(tabs: Tab[], targetTabSpace: TabSpace): TabSpace {
  let tabSpace = cloneTabSpace(targetTabSpace);
  tabs.forEach((tab) => (tabSpace = insertTab({ tab }, tabSpace)));
  return tabSpace;
}

export function updateTab(
  { tid, changes }: { tid: string; changes: Partial<Tab> },
  targetTabSpace: TabSpace,
): TabSpace {
  const tIndex = targetTabSpace.tabs.findIndex((tab) => tab.id === tid);
  if (tIndex >= 0) {
    const existTab = targetTabSpace.tabs.get(tIndex);
    const newTab = { ...existTab, ...changes };
    return { ...targetTabSpace, tabs: targetTabSpace.tabs.set(tIndex, newTab) };
  } else {
    return cloneTabSpace(targetTabSpace);
  }
}

export function removeTabByIndex(
  index: number,
  targetTabSpace: TabSpace,
): TabSpace {
  if (index >= 0 && index < targetTabSpace.tabs.size) {
    return { ...targetTabSpace, tabs: targetTabSpace.tabs.remove(index) };
  } else {
    return cloneTabSpace(targetTabSpace);
  }
}

export function removeTab(tab: Tab, targetTabSpace: TabSpace): TabSpace {
  const tIndex = targetTabSpace.tabs.findIndex((t) => t.id === tab.id);
  return removeTabByIndex(tIndex, targetTabSpace);
}

export function removeTabById(tid: string, targetTabSpace: TabSpace): TabSpace {
  const tIndex = targetTabSpace.tabs.findIndex((t) => t.id === tid);
  return removeTabByIndex(tIndex, targetTabSpace);
}

export function removeTabByChromeTabId(
  chromeTabId: number,
  targetTabSpace: TabSpace,
): TabSpace {
  const tIndex = targetTabSpace.tabs.findIndex(
    (tab) => tab.chromeTabId === chromeTabId,
  );
  return removeTabByIndex(tIndex, targetTabSpace);
}

export function replaceTab(
  { tid, tab }: { tid: string; tab: Tab },
  targetTabSpace: TabSpace,
): TabSpace {
  const tIndex = targetTabSpace.tabs.findIndex((t) => t.id === tid);
  if (tIndex >= 0 && tIndex < targetTabSpace.tabs.size) {
    return { ...targetTabSpace, tabs: targetTabSpace.tabs.set(tIndex, tab) };
  } else {
    return cloneTabSpace(targetTabSpace);
  }
}

export function replaceAllTabs(
  tabs: Tab[],
  targetTabSpace: TabSpace,
): TabSpace {
  return { ...targetTabSpace, tabs: List(tabs) };
}

export function convertAndGetTabSpaceSavePayload(targetTabSpace: TabSpace): {
  tabSpace: TabSpace;
  tabSpaceSavePayload: TabSpaceSavePayload;
  isNewTabSpace: boolean;
  newTabSavePayloads: TabCore[];
  existTabSavePayloads: TabCore[];
} {
  const isNewTabSpace = isIdNotSaved(targetTabSpace.id);
  const existTabSavePayloads: TabCore[] = [];
  const newTabSavePayloads: TabCore[] = [];
  const savedTabs = targetTabSpace.tabs
    .map((tab: Tab) => {
      const isNewTab = isIdNotSaved(tab.id);
      const { tab: updatedTab, savedTab } = convertAndGetTabSavePayload(
        tab,
        getSavedId(targetTabSpace.id),
      );
      if (isNewTab) {
        newTabSavePayloads.push(savedTab);
      } else {
        existTabSavePayloads.push(savedTab);
      }
      return updatedTab;
    })
    .toList();
  const tabSpace = {
    ...targetTabSpace,
    ...convertToSavedBase(targetTabSpace),
    tabs: savedTabs,
  };
  const tabSpaceSavePayload = {
    ...convertToSavedBase(targetTabSpace),
    name: targetTabSpace.name,
    tabIds: savedTabs.map((tab) => tab.id).toArray(),
  };
  return {
    tabSpace,
    tabSpaceSavePayload,
    isNewTabSpace,
    newTabSavePayloads,
    existTabSavePayloads,
  };
}

export function toTabSpaceStub(targetTabSpace: TabSpace): TabSpaceStub {
  return {
    ...toBase(targetTabSpace),
    name: targetTabSpace.name,
    chromeTabId: targetTabSpace.chromeTabId,
    chromeWindowId: targetTabSpace.chromeWindowId,
  };
}
