import { IBase, setAttrForObject } from '../common';
import { convertToSavedBase, newEmptyBase, updateFromSaved } from '../Base';

import { List } from 'immutable';
import { isEqual } from 'lodash';

export const NotTabSpaceTabId = -1;
export const NotTabSpaceId = '';
export const NotSessionId = '';

export interface ChromeTab {
  tabId: number;
  windowId: number;
  title: string;
  url: string;
  favIconUrl: string;
}

export type ChromeTabSavePayload = ChromeTab;

export interface ChromeWindow {
  windowId: number;
  tabIds: List<number>;
  tabSpaceTabId: number;
  tabSpaceId: string;
}

export type ChromeWindowSavePayload = Omit<ChromeWindow, 'tabIds'> & {
  tabIds: number[];
};

export interface ChromeSessionSavePayload extends IBase {
  tag: string;
  tabs: ChromeTabSavePayload[];
  windows: ChromeWindowSavePayload[];
}

export interface ChromeSession extends IBase {
  tag: string;
  tabs: List<ChromeTab>;
  windows: List<ChromeWindow>;
}

export const CHROMESESSION_DB_TABLE_NAME = 'ChromeSession';
export const CHROMESESSION_DB_SCHEMA = 'id, tag, createdAt, updatedAt';

export const ChromeTab = {
  new: (
    tabId: number,
    windowId: number,
    title?: string,
    url?: string,
    favIconUrl?: string,
  ): ChromeTab => ({
    tabId,
    windowId,
    title: title ?? '',
    url: url ?? '',
    favIconUrl: favIconUrl ?? '',
  }),
};

export const ChromeWindow = {
  new: (windowId: number): ChromeWindow => ({
    windowId,
    tabIds: List(),
    tabSpaceTabId: NotTabSpaceTabId,
    tabSpaceId: NotTabSpaceId,
  }),

  setTabSpaceTabId: (
    chromeWindow: ChromeWindow,
    tabSpaceTabId: number,
  ): ChromeWindow => {
    return {
      ...chromeWindow,
      tabSpaceTabId,
    };
  },

  setTabSpaceId: (
    chromeWindow: ChromeWindow,
    tabSpaceId: string,
  ): ChromeWindow => {
    return {
      ...chromeWindow,
      tabSpaceId,
    };
  },

  getSavePayload: (chromeWindow: ChromeWindow): ChromeWindowSavePayload => {
    return {
      windowId: chromeWindow.windowId,
      tabIds: chromeWindow.tabIds.toArray(),
      tabSpaceTabId: chromeWindow.tabSpaceTabId,
      tabSpaceId: chromeWindow.tabSpaceId,
    };
  },

  fromSavePayload: (savedPayload: ChromeWindowSavePayload): ChromeWindow => {
    return {
      windowId: savedPayload.windowId,
      tabIds: List(savedPayload.tabIds),
      tabSpaceTabId: savedPayload.tabSpaceTabId,
      tabSpaceId: savedPayload.tabSpaceId,
    };
  },
};

export function newEmptyChromeSession(): ChromeSession {
  return {
    ...newEmptyBase(),
    createdAt: Date.now(),
    tag: '',
    tabs: List(),
    windows: List(),
  };
}

export function cloneChromeSession(
  targetChromeSession: ChromeSession,
): ChromeSession {
  return {
    ...targetChromeSession,
    tabs: List(targetChromeSession.tabs),
    windows: List(targetChromeSession.windows),
  };
}

export function findWindow(
  windowId: number,
  targetChromeSession: ChromeSession,
): ChromeWindow {
  return targetChromeSession.windows.find(
    (window) => window.windowId === windowId,
  );
}

export function replaceWindowTabIds(
  windowId: number,
  tabIds: number[],
  targetChromeSession: ChromeSession,
): ChromeSession {
  const windowIndex = targetChromeSession.windows.findIndex(
    (window) => window.windowId === windowId,
  );
  const window = findWindow(windowId, targetChromeSession);
  if (windowIndex >= 0) {
    const window = targetChromeSession.windows.get(windowIndex);
    const newWindow = {
      ...window,
      tabIds: List(tabIds.filter((tabId) => tabId !== window.tabSpaceTabId)),
    };
    return {
      ...targetChromeSession,
      windows: targetChromeSession.windows.set(windowIndex, newWindow),
    };
  } else {
    return cloneChromeSession(targetChromeSession);
  }
}

export function addTab(
  tab: ChromeTab,
  targetChromeSession: ChromeSession,
): ChromeSession {
  const index = targetChromeSession.tabs.findIndex(
    (t) => t.tabId === tab.tabId,
  );
  if (index < 0) {
    return {
      ...targetChromeSession,
      tabs: targetChromeSession.tabs.push(tab),
    };
  } else {
    return cloneChromeSession(targetChromeSession);
  }
}

export function addWindow(
  windowId: number,
  targetChromeSession: ChromeSession,
): ChromeSession {
  return {
    ...targetChromeSession,
    windows: targetChromeSession.windows.push(ChromeWindow.new(windowId)),
  };
}

export function setWindowTabSpaceTabId(
  windowId: number,
  tabSpaceTabId: number,
  tabSpaceId: string,
  targetChromeSession: ChromeSession,
): ChromeSession {
  const index = targetChromeSession.windows.findIndex(
    (t) => t.windowId === windowId,
  );
  if (index >= 0) {
    const window = targetChromeSession.windows.get(index);
    let updatedWindow = ChromeWindow.setTabSpaceTabId(window, tabSpaceTabId);
    updatedWindow = ChromeWindow.setTabSpaceId(updatedWindow, tabSpaceId);
    return {
      ...targetChromeSession,
      windows: targetChromeSession.windows.set(index, updatedWindow),
    };
  } else {
    return cloneChromeSession(targetChromeSession);
  }
}

export function convertAndGetSavePayload(targetChromeSession: ChromeSession): {
  chromeSession: ChromeSession;
  savePayload: ChromeSessionSavePayload;
} {
  const savedBase = convertToSavedBase(targetChromeSession);
  const updatedChromeSession = {
    ...targetChromeSession,
    ...savedBase,
  };
  const savePayload = {
    ...savedBase,
    tag: updatedChromeSession.tag,
    tabs: updatedChromeSession.tabs.toArray(),
    windows: updatedChromeSession.windows
      .map((window) => ChromeWindow.getSavePayload(window))
      .toArray(),
  };
  return { chromeSession: updatedChromeSession, savePayload };
}

export function fromSavePayload(
  savedPayload: ChromeSessionSavePayload,
): ChromeSession {
  let chromeSession = updateFromSaved(savedPayload, newEmptyChromeSession());
  chromeSession = setAttrForObject('tag', savedPayload.tag, chromeSession);
  chromeSession = setAttrForObject(
    'tabs',
    List(savedPayload.tabs),
    chromeSession,
  );
  chromeSession = setAttrForObject(
    'windows',
    List(
      savedPayload.windows.map((window) =>
        ChromeWindow.fromSavePayload(window),
      ),
    ),
    chromeSession,
  );

  return chromeSession;
}

function isTabsChanged(tabs1: ChromeTab[], tabs2: ChromeTab[]): boolean {
  if (tabs1.length !== tabs2.length) {
    return true;
  }
  const allUrls1 = tabs1.map((tab) => tab.url).sort();
  const allUrls2 = tabs2.map((tab) => tab.url).sort();
  return JSON.stringify(allUrls1) !== JSON.stringify(allUrls2);
}

export function isChromeSessionChanged(
  s1: ChromeSessionSavePayload,
  s2: ChromeSessionSavePayload,
) {
  if (s1.tag !== s2.tag) {
    return true;
  }

  if (isTabsChanged(s1.tabs, s2.tabs)) {
    return true;
  }

  if (s1.windows.length !== s2.windows.length) {
    return true;
  } else {
    for (let i = 0; i < s1.windows.length; i++) {
      if (
        s1.windows[i].windowId !== s2.windows[i].windowId ||
        !isEqual(s1.windows[i].tabIds, s2.windows[i].tabIds)
      ) {
        return true;
      }
    }
  }

  return false;
}
