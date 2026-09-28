import {
  IBase,
  getSavedId,
  getUnsavedNewId,
  isIdNotSaved,
  setAttrForObject2,
} from '../common';
import {
  Tab,
  TabCore,
  convertAndGetTabSavePayload,
  isEqualWithoutCreatedAtUpdatedAt,
  setTabSpaceId,
} from './Tab';
import {
  convertToSavedBase,
  inPlaceCopyFromOtherBase,
  newEmptyBase,
} from '../Base';
import { eq, omit } from 'lodash';

import { List } from 'immutable';
import { produce } from 'immer';

export interface LiveTabSpace {
  chromeTabId: number;
  chromeWindowId: number;
}

/** The nine group colours Chrome's tabGroups API exposes (and only those). */
export type TabGroupColor =
  | 'grey'
  | 'blue'
  | 'red'
  | 'yellow'
  | 'green'
  | 'pink'
  | 'purple'
  | 'cyan'
  | 'orange';

export const TAB_GROUP_COLORS: TabGroupColor[] = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
];

/**
 * A tab group as Tabverse remembers it.
 *
 * `id` is ours, never Chrome's: `chrome.tabGroups` group ids are "unique within
 * a browser session", so they are worthless after a restart. The live
 * ourId -> chromeId mapping lives in the tabspace's non-persisted part
 * (see LiveTabSpace) and is rebuilt on every scan.
 */
export interface TabGroupHint {
  id: string;
  title: string;
  color: TabGroupColor;
  /** ids of the tabverse's own tabs, not chrome tab ids */
  tabIds: string[];
}

export interface TabSpaceCore extends IBase {
  name: string;
  tabs: List<Tab>;
  tabGroups: TabGroupHint[];
}

export type TabSpace = TabSpaceCore & LiveTabSpace;

export interface TabSpaceSavePayload extends IBase {
  name: string;
  tabIds: string[];
  tabGroups: TabGroupHint[];
}

export const TABSPACE_DB_TABLE_NAME = 'SavedTabSpace';
export const TABSPACE_DB_SCHEMA = 'id, name, *tabIds, windowId, createdAt';

export function newEmptyTabSpace(): TabSpace {
  return {
    ...newEmptyBase(),
    name: '',
    tabs: List<Tab>(),
    tabGroups: [],
    chromeTabId: -1,
    chromeWindowId: -1,
  };
}

export function cloneTabSpace(targetTabSpace: TabSpace): TabSpace {
  return produce(targetTabSpace, (draft) => {});
}

export function updateTabSpace(
  changes: Partial<Omit<TabSpace, 'tabIds'>>,
  targetTabSpace: TabSpace,
): TabSpace {
  return produce(targetTabSpace, (draft) => {
    Object.keys(changes).forEach((key) => {
      draft[key] = changes[key];
    });
  });
}

export const setId = setAttrForObject2<string, TabSpace>('id');
export const setTabGroups = setAttrForObject2<TabGroupHint[], TabSpace>(
  'tabGroups',
);
export const setName = setAttrForObject2<string, TabSpace>('name');
export const setChromeTabId = setAttrForObject2<number, TabSpace>(
  'chromeTabId',
);
export const setChromeWindowId = setAttrForObject2<number, TabSpace>(
  'chromeWindowId',
);

export function getTabIds(targetTabSpace: TabSpace): string[] {
  return targetTabSpace.tabs.map((tab) => tab.id).toArray();
}

/**
 * Whether this tabverse may be written to the database (and, through the change
 * feed, to the sync server).
 *
 * Always true since tabverses became born saved: the id is minted when the
 * Tabverse tab is opened and travels in its url as `tvid`, so opening a
 * Tabverse *is* the decision to keep this window's tabs. The function is kept
 * because the note/todo/bookmark autosave paths ask it about the *tabspace*
 * before saving their own rows.
 */
export function needAutoSave(targetTabSpace: TabSpace): boolean {
  return true;
}

export function isEqual(t1: TabSpace, t2: TabSpace): boolean {
  return (
    eq(omit(t1, 'tabs'), omit(t2, 'tabs')) &&
    eq(t1.tabs.toArray(), t2.tabs.toArray())
  );
}

export function isEqualTabs(t1: TabSpace, t2: TabSpace): boolean {
  const t1Tabs: Tab[] = t1.tabs.toJS();
  const t2Tabs: Tab[] = t2.tabs.toJS();
  return (
    t1Tabs.length === t2Tabs.length &&
    t1Tabs.reduce((r, _tab1, index) => {
      if (!r) {
        return false;
      }
      if (isEqualWithoutCreatedAtUpdatedAt(t1Tabs[index], t2Tabs[index])) {
        return r && true;
      } else {
        return r && false;
      }
    }, false)
  );
}

export function isEqualWithoutCreateAtUpdateAt(
  t1: TabSpace,
  t2: TabSpace,
): boolean {
  return (
    t1.chromeTabId === t2.chromeTabId &&
    t1.chromeWindowId === t2.chromeWindowId &&
    t1.id === t2.id &&
    t1.name === t2.name &&
    t1.version === t2.version &&
    isEqualTabs(t1, t2)
  );
}

export function fromSavedDataWithoutTabs(d: TabSpaceSavePayload): TabSpace {
  return {
    ...newEmptyTabSpace(),
    ...omit(d, 'tabIds'),
    // tabverses saved before groups existed have no field at all
    tabGroups: d.tabGroups ?? [],
  };
}

export function reset(
  {
    chromeTabId,
    chromeWindowId,
    newId,
  }: { chromeTabId?: number; chromeWindowId?: number; newId?: string },
  targetTabSpace: TabSpace,
): TabSpace {
  return produce(targetTabSpace, (draft) => {
    draft.chromeTabId = chromeTabId ?? -1;
    draft.chromeWindowId = chromeWindowId ?? -1;
    draft.id = newId ?? getUnsavedNewId();
    draft.tabs = List();
  });
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
  return produce(targetTabSpace, (draft) => {
    const newTab = setTabSpaceId(draft.id, tab);
    if (index && index >= 0 && index < draft.tabs.size) {
      draft.tabs = draft.tabs.insert(index, newTab);
    } else if (index && index < 0) {
      draft.tabs = draft.tabs.insert(0, newTab);
    } else {
      // index && index >= targetTabSpace.tabs.size
      // or no index provided
      draft.tabs = draft.tabs.push(newTab);
    }
  });
}

export function addTabs(tabs: Tab[], targetTabSpace: TabSpace): TabSpace {
  let newTabSpace: TabSpace = targetTabSpace;
  tabs.forEach((tab) => {
    newTabSpace = insertTab({ tab }, newTabSpace);
  });
  return newTabSpace;
}

export function updateTab(
  { tid, changes }: { tid: string; changes: Partial<Tab> },
  targetTabSpace: TabSpace,
): TabSpace {
  return produce(targetTabSpace, (draft) => {
    const tIndex = draft.tabs.findIndex((tab) => tab.id === tid);
    if (tIndex >= 0) {
      const existTab = draft.tabs.get(tIndex);
      const newTab = { ...existTab, ...changes, tabSpaceId: draft.id };
      draft.tabs = draft.tabs.set(tIndex, newTab);
    }
  });
}

export function removeTabByIndex(
  index: number,
  targetTabSpace: TabSpace,
): TabSpace {
  return produce(targetTabSpace, (draft) => {
    if (index >= 0 && index < draft.tabs.size) {
      draft.tabs = draft.tabs.remove(index);
    }
  });
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
  return produce(targetTabSpace, (draft) => {
    const tIndex = draft.tabs.findIndex((t) => t.id === tid);
    if (tIndex >= 0 && tIndex < draft.tabs.size) {
      draft.tabs = draft.tabs.set(tIndex, tab);
    }
  });
}

export function replaceAllTabs(
  tabs: Tab[],
  targetTabSpace: TabSpace,
): TabSpace {
  return produce(targetTabSpace, (draft) => {
    draft.tabs = List(tabs);
  });
}

/**
 * Rewrites group membership after a save renames tab ids (the '~' prefix is
 * dropped the first time a tab is saved).
 *
 * `idRemap` covers the rename; `validTabIds` covers the other case - a tab that
 * was closed or moved to another tabverse, whose id is simply not in the
 * tabverse any more. Both would otherwise leave the hint pointing at tabs that
 * do not exist, and the group would render as a silently broken entry. A group
 * left with nothing is dropped.
 */
export function remapTabGroups(
  groups: TabGroupHint[] | undefined,
  idRemap: Map<string, string>,
  validTabIds: Set<string>,
): TabGroupHint[] {
  if (!groups || groups.length === 0) {
    return [];
  }
  const out: TabGroupHint[] = [];
  for (const group of groups) {
    const tabIds: string[] = [];
    for (const oldId of group.tabIds ?? []) {
      // an id that was not renamed is already its final form
      const newId = idRemap.get(oldId) ?? oldId;
      if (validTabIds.has(newId) && tabIds.indexOf(newId) < 0) {
        tabIds.push(newId);
      }
    }
    if (tabIds.length === 0) {
      continue;
    }
    out.push({ ...group, tabIds });
  }
  return out;
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
  // saving strips the '~' from every tab id, so remember what each one became:
  // group membership references tab ids and has to follow the rename, or the
  // hints point at tabs that no longer exist and the group silently disappears
  const idRemap = new Map<string, string>();
  const savedTabs = targetTabSpace.tabs
    .map((tab: Tab) => {
      const isNewTab = isIdNotSaved(tab.id);
      const { tab: updatedTab, savedTab } = convertAndGetTabSavePayload(
        tab,
        getSavedId(targetTabSpace.id),
      );
      if (updatedTab.id !== tab.id) {
        idRemap.set(tab.id, updatedTab.id);
      }
      if (isNewTab) {
        newTabSavePayloads.push(savedTab);
      } else {
        existTabSavePayloads.push(savedTab);
      }
      return updatedTab;
    })
    .toList();
  const savedBase = convertToSavedBase(targetTabSpace);
  const savedTabGroups = remapTabGroups(
    targetTabSpace.tabGroups,
    idRemap,
    new Set(savedTabs.map((tab) => tab.id).toArray()),
  );
  const tabSpace = produce(targetTabSpace, (draft) => {
    inPlaceCopyFromOtherBase(draft, savedBase);
    draft.tabs = savedTabs;
    draft.tabGroups = savedTabGroups;
  });
  const tabSpaceSavePayload = {
    ...savedBase,
    name: targetTabSpace.name,
    tabIds: savedTabs.map((tab) => tab.id).toArray(),
    tabGroups: savedTabGroups,
  };
  return {
    tabSpace,
    tabSpaceSavePayload,
    isNewTabSpace,
    newTabSavePayloads,
    existTabSavePayloads,
  };
}
