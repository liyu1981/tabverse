import { Base, IBase } from '../common';
import { isEqual, merge } from 'lodash';

import { List } from 'immutable';

export const NotTabSpaceTabId = -1;
export const NotTabSpaceId = '';
export const NotSessionId = '';

export interface IChromeTab {
  tabId: number;
  windowId: number;
  title: string;
  url: string;
  favIconUrl: string;
}

export type IChromeTabSavePayload = IChromeTab;

export interface IChromeWindow {
  windowId: number;
  tabIds: List<number>;
  tabSpaceTabId: number;
  tabSpaceId: string;
}

export interface IChromeWindowSavePayload {
  windowId: number;
  tabIds: number[];
  tabSpaceTabId: number;
  tabSpaceId: string;
}

export interface IChromeSessionSavePayload extends IBase {
  tag: string;
  tabs: IChromeTabSavePayload[];
  windows: IChromeWindowSavePayload[];
}

export interface IChromeSession extends IBase {
  tabs: List<IChromeTab>;
  windows: List<IChromeWindow>;
}

export const ChromeTab = {
  new: (
    tabId: number,
    windowId: number,
    title?: string,
    url?: string,
    favIconUrl?: string,
  ): IChromeTab => ({
    tabId,
    windowId,
    title: title ?? '',
    url: url ?? '',
    favIconUrl: favIconUrl ?? '',
  }),
};

export const ChromeWindow = {
  new: (windowId: number): IChromeWindow => ({
    windowId,
    tabIds: List(),
    tabSpaceTabId: NotTabSpaceTabId,
    tabSpaceId: NotTabSpaceId,
  }),

  setTabSpaceTabId: (
    chromeWindow: IChromeWindow,
    tabSpaceTabId: number,
  ): IChromeWindow => {
    return {
      ...chromeWindow,
      tabSpaceTabId,
    };
  },

  setTabSpaceId: (
    chromeWindow: IChromeWindow,
    tabSpaceId: string,
  ): IChromeWindow => {
    return {
      ...chromeWindow,
      tabSpaceId,
    };
  },

  getSavePayload: (chromeWindow: IChromeWindow): IChromeWindowSavePayload => {
    return {
      windowId: chromeWindow.windowId,
      tabIds: chromeWindow.tabIds.toArray(),
      tabSpaceTabId: chromeWindow.tabSpaceTabId,
      tabSpaceId: chromeWindow.tabSpaceId,
    };
  },

  fromSavePayload: (savedPayload: IChromeWindowSavePayload): IChromeWindow => {
    return {
      windowId: savedPayload.windowId,
      tabIds: List(savedPayload.tabIds),
      tabSpaceTabId: savedPayload.tabSpaceTabId,
      tabSpaceId: savedPayload.tabSpaceId,
    };
  },
};

export class ChromeSession extends Base implements IChromeSession {
  tag: string;
  tabs: List<IChromeTab>;
  windows: List<IChromeWindow>;

  static DB_TABLE_NAME = 'ChromeSession';
  static DB_SCHEMA = 'id, tag, createdAt, updatedAt';

  constructor(id?: string) {
    super(id);
    this.createdAt = Date.now();
    this.tag = '';
    this.tabs = List();
    this.windows = List();
  }

  findWindow(windowId: number) {
    return this.windows.find((window) => window.windowId === windowId);
  }

  replaceWindowTabIds(windowId: number, tabIds: number[]) {
    const window = this.findWindow(windowId);
    if (window) {
      window.tabIds = List(
        tabIds.filter((tabId) => tabId !== window.tabSpaceTabId),
      );
    }
    return this;
  }

  addTab(tab: IChromeTab) {
    const index = this.tabs.findIndex((t) => t.tabId === tab.tabId);
    if (index < 0) {
      this.tabs = this.tabs.push(Object.freeze(tab));
    }
    return this;
  }

  addWindow(windowId) {
    this.windows = this.windows.push(ChromeWindow.new(windowId));
    return this;
  }

  setWindowTabSpaceTabId(
    windowId: number,
    tabSpaceTabId: number,
    tabSpaceId: string,
  ) {
    const index = this.windows.findIndex((t) => t.windowId === windowId);
    if (index >= 0) {
      const window = this.windows.get(index);
      let updatedWindow = ChromeWindow.setTabSpaceTabId(window, tabSpaceTabId);
      updatedWindow = ChromeWindow.setTabSpaceId(updatedWindow, tabSpaceId);
      this.windows = this.windows.set(index, updatedWindow);
    }
    return this;
  }

  getSavePayload(): IChromeSessionSavePayload {
    this.convertToSaved();
    return merge(super.toJSON(), {
      tag: this.tag,
      tabs: this.tabs.toArray(),
      windows: this.windows
        .map((window) => ChromeWindow.getSavePayload(window))
        .toArray(),
    });
  }

  static fromSavePayload(
    savedPayload: IChromeSessionSavePayload,
  ): ChromeSession {
    const cs = new ChromeSession(savedPayload.id);
    cs.cloneAttributes(savedPayload);
    cs.tag = savedPayload.tag;
    cs.tabs = List(savedPayload.tabs);
    cs.windows = List(
      savedPayload.windows.map((window) =>
        ChromeWindow.fromSavePayload(window),
      ),
    );
    return cs;
  }
}

function isTabsChanged(tabs1: IChromeTab[], tabs2: IChromeTab[]): boolean {
  if (tabs1.length !== tabs2.length) {
    return true;
  }
  const allUrls1 = tabs1.map((tab) => tab.url).sort();
  const allUrls2 = tabs2.map((tab) => tab.url).sort();
  return JSON.stringify(allUrls1) !== JSON.stringify(allUrls2);
}

export function isChromeSessionChanged(
  s1: IChromeSessionSavePayload,
  s2: IChromeSessionSavePayload,
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
