import * as PubSub from 'pubsub-js';

import { concat, filter, forEach, merge, pick } from 'lodash';

import { getNewId } from '../data/common';

interface IMockListenable {
  addListener: (callback: any) => void;
  sendMessage: (payload: any) => void;
}

function getMockListenable(type: string): IMockListenable {
  const msgType = type;
  return {
    addListener: (callback: any) => {
      // console.log('subscribe', msgType, callback);
      PubSub.subscribe(msgType, (msgType, payload) => {
        callback(...payload);
      });
    },
    sendMessage: (args: any[]) => {
      // console.log('publish', msgType, arguments);
      PubSub.publish(msgType, args);
    },
  };
}

class MockRuntime {
  onMessage: IMockListenable;
  defaultCallback: any;

  constructor(tag: string) {
    this.onMessage = getMockListenable(`onMessage${tag}`);
    this.defaultCallback = () => {};
  }

  sendMessage(
    msgPayload: any,
    callback?: (response: any) => void,
    senderId = 'unknown',
  ) {
    const theCallback =
      callback === undefined ? this.defaultCallback : callback;
    this.onMessage.sendMessage([
      msgPayload,
      { id: senderId } as chrome.runtime.MessageSender,
      theCallback,
    ]);
  }
}

interface IMockTabData {
  title: string;
  url: string;
  favIconUrl: string;
  pinned: boolean;
}

interface IMockTab extends IMockTabData {
  id: number;
  windowId: number;
  position: number;
  active?: boolean;
}

export function toIMockTabData(t: IMockTab): IMockTabData {
  return pick(t, ['title', 'url', 'favIconUrl', 'pinned']);
}

class MockTabs {
  tabs: IMockTab[];
  activeTabIndex: number;

  constructor() {
    this.tabs = [];
    this.activeTabIndex = 0;
  }

  toJSON() {
    return {
      activeTabIndex: this.activeTabIndex,
      tabs: this.tabs,
    };
  }

  _reassignTabPositions(activeTabId: number) {
    forEach(this.tabs, (tab, index) => {
      tab.position = index;
    });
    this.activeTabIndex = this.tabs.findIndex((tab) => tab.id === activeTabId);
    if (this.activeTabIndex < 0) {
      this.activeTabIndex = 0;
    }
  }

  async get(id: number) {
    const t = this.tabs.find((tab) => tab.id === id);
    if (t && t.position === this.activeTabIndex) {
      t.active = true;
    }
    return t;
  }

  async query(params: chrome.tabs.QueryInfo): Promise<any[]> {
    let result = [];

    if (params.active) {
      result = this.tabs.filter((t, index) => index === this.activeTabIndex);
    } else {
      result = this.tabs;
    }

    return result;
  }
}

class MockTabsApi {
  chrome: MockChrome;
  onAttached: IMockListenable;
  onCreated: IMockListenable;
  onDetached: IMockListenable;
  onRemoved: IMockListenable;
  onReplaced: IMockListenable;
  onUpdated: IMockListenable;
  onMoved: IMockListenable;
  onActivated: IMockListenable;

  constructor(tag: string, chrome: MockChrome) {
    this.chrome = chrome;
    this.onAttached = getMockListenable(`tabOnAttached${tag}`);
    this.onCreated = getMockListenable(`tabOnCreated${tag}`);
    this.onDetached = getMockListenable(`tabOnDetached${tag}`);
    this.onRemoved = getMockListenable(`tabOnRemoved${tag}`);
    this.onReplaced = getMockListenable(`tabOnReplaced${tag}`);
    this.onUpdated = getMockListenable(`tabOnUpdated${tag}`);
    this.onMoved = getMockListenable(`tabOnMoved${tag}`);
    this.onActivated = getMockListenable(`tabOnActivated${tag}`);
  }

  async get(id: number) {
    for (let i = 0; i < this.chrome.mockWindows.length; i++) {
      const w = this.chrome.mockWindows[i];
      const t = await w.tabs.get(id);
      if (t) {
        return t;
      }
    }
    return null;
  }

  async query(params: chrome.tabs.QueryInfo): Promise<any[]> {
    let result = [];
    if (params.currentWindow) {
      const w = this.chrome._getCurrentWindow();
      result = await w.tabs.query(params);
    } else if (params.windowId) {
      const w = this.chrome.getWindow(params.windowId);
      result = await w.tabs.query(params);
    } else {
      const results = await Promise.all(
        this.chrome.mockWindows.map((window) => window.tabs.query(params)),
      );
      result = concat(...results);
    }

    return result;
  }

  async captureVisibleTab(windowId?: number, params?: any): Promise<string> {
    const w = this.chrome._getCurrentWindow();
    return `data:${w.id}.${w.tabs.tabs[w.tabs.activeTabIndex].id}`;
  }

  async update(tabId: number, params: { [k: string]: any }) {
    if (params && params.active) {
      this.chrome.setActiveTab(tabId);
    }
  }
}

class MockWindow {
  id: number;
  tabs: MockTabs;

  constructor(windowId: number) {
    this.id = windowId;
    this.tabs = new MockTabs();
  }

  toJSON() {
    return {
      id: this.id,
      tabs: this.tabs.toJSON(),
    };
  }

  getTab(tabId: number): IMockTab | null {
    return this.tabs.tabs.find((tab) => tab.id === tabId);
  }

  insertTab(t: IMockTab, position?: number): IMockTab {
    if (this.tabs.tabs.length === 0) {
      this.tabs.tabs = [t];
      this.tabs._reassignTabPositions(t.id);
      return t;
    }

    const targetPosition =
      position !== undefined ? position : this.tabs.tabs.length;
    const activeTabId = this.tabs.tabs[this.tabs.activeTabIndex].id;

    if (targetPosition <= 0) {
      this.tabs.tabs = concat([t], this.tabs.tabs);
    } else if (targetPosition >= this.tabs.tabs.length) {
      this.tabs.tabs = concat(this.tabs.tabs, [t]);
    } else {
      this.tabs.tabs = concat(
        this.tabs.tabs.slice(0, targetPosition),
        [t],
        this.tabs.tabs.slice(targetPosition),
      );
    }
    this.tabs._reassignTabPositions(activeTabId);

    return t;
  }

  removeTab(tabId: number) {
    const activeTabId = this.tabs.tabs[this.tabs.activeTabIndex].id;
    this.tabs.tabs = filter(this.tabs.tabs, (t) => t.id !== tabId);
    this.tabs._reassignTabPositions(activeTabId);
  }
}

class MockWindowsApi {
  chrome: MockChrome;
  onCreated: IMockListenable;
  onRemoved: IMockListenable;

  constructor(tag: string, mockChrome: MockChrome) {
    this.chrome = mockChrome;
    this.onCreated = getMockListenable(`windowOnCreated${tag}`);
    this.onRemoved = getMockListenable(`windowOnRemoved${tag}`);
  }

  async getAll() {
    return this.chrome.mockWindows;
  }
}

class MockChrome {
  mockWindows: MockWindow[];
  tabs: MockTabsApi; // this tabs is for messages, real tabs are inside windows
  windows: MockWindowsApi;
  runtime: MockRuntime;
  currentWindowId: number;
  mocked: string;
  nextTabId: number;
  nextWindowId: number;

  constructor() {
    this.reset();
  }

  reset() {
    this.mockWindows = [];
    this.runtime = new MockRuntime(getNewId());
    this.currentWindowId = -1;
    this.mocked = getNewId();
    this.nextTabId = 100;
    this.nextWindowId = 1000;
    this.tabs = new MockTabsApi(this.mocked, this);
    this.windows = new MockWindowsApi(this.mocked, this);
  }

  toJSON() {
    return {
      currentWindowId: this.currentWindowId,
      nextTabId: this.nextTabId,
      nextWindowId: this.nextWindowId,
      windows: this.mockWindows.map((window) => window.toJSON()),
    };
  }

  _nextTabId() {
    this.nextTabId += 1;
    return this.nextTabId;
  }

  _nextWindowId() {
    this.nextWindowId += 1;
    return this.nextWindowId;
  }

  _newTabFromData(td: IMockTabData, window: number): IMockTab {
    return {
      id: this._nextTabId(),
      windowId: window,
      position: -1,
      ...td,
    };
  }

  _getCurrentWindow() {
    return this.mockWindows.find(
      (window) => window.id === this.currentWindowId,
    );
  }

  async flushMessages(delay = 500) {
    return new Promise((r) => setTimeout(r, delay));
  }

  setCurrentWindow(id: number) {
    this.currentWindowId = id;
  }

  getTab(tabId: number): IMockTab | null {
    for (let i = 0; i < this.mockWindows.length; i++) {
      const w = this.mockWindows[i];
      const t = w.getTab(tabId);
      if (t) {
        return t;
      }
    }
    return null;
  }

  getWindow(windowId?: number): MockWindow | null {
    if (windowId) {
      return this.mockWindows.find((window) => window.id === windowId);
    } else {
      return this.mockWindows.find(
        (window) => window.id === this.currentWindowId,
      );
    }
  }

  setActiveTab(tabId: number): IMockTab | null {
    const t = this.getTab(tabId);
    if (t) {
      this.currentWindowId = t.windowId;
      const w = this.getWindow(t.windowId);
      w.tabs.activeTabIndex = t.position;
      this.tabs.onActivated.sendMessage([
        { tabId: t.id, windowId: t.windowId },
      ]);
    }
    return t;
  }

  insertTabFromData(
    td: IMockTabData,
    windowId?: number,
    position?: number,
    notify = true,
  ) {
    const t = this._newTabFromData(td, windowId);
    this.insertTab(t, windowId, position);
    if (notify) {
      this.tabs.onCreated.sendMessage([t]);
    }
    return t;
  }

  replaceTabFromData(
    td: IMockTabData,
    toReplaceTabId: number,
  ): IMockTab | null {
    const toReplaceTab = this.getTab(toReplaceTabId);
    if (toReplaceTab) {
      this.removeTab(toReplaceTab.id, false);
      const t = this.insertTabFromData(
        td,
        toReplaceTab.windowId,
        toReplaceTab.position,
        false,
      );
      this.tabs.onReplaced.sendMessage([t.id, toReplaceTab.id]);
      return t;
    }
    return null;
  }

  insertTab(t: IMockTab, windowId?: number, position?: number) {
    const w = this.getWindow(windowId);
    if (w) {
      if (t.windowId !== w.id) {
        t.windowId = w.id;
      }
      t = w.insertTab(t, position);
    }
    return t;
  }

  removeTab(tabId: number, notify = true): IMockTab | null {
    const t = this.getTab(tabId);
    if (t) {
      const w = this.getWindow(t.windowId);
      w.removeTab(tabId);
      if (notify) {
        this.tabs.onRemoved.sendMessage([
          t.id,
          { windowId: t.windowId, isWindowClosing: false },
        ]);
      }
    }
    return t;
  }

  moveTab(tabId: number, position: number) {
    const t = this.removeTab(tabId, false);
    if (t) {
      const fromIndex = t.position;
      this.insertTab(t, t.windowId, position);
      this.tabs.onMoved.sendMessage([
        t.id,
        { toIndex: t.position, windowId: t.windowId, fromIndex: fromIndex },
      ]);
    }
  }

  updateTab(
    tabId: number,
    params: Partial<IMockTabData>,
    notify = true,
  ): IMockTab | null {
    const t = this.getTab(tabId);
    if (t) {
      merge(t, params);
      if (notify) {
        this.tabs.onUpdated.sendMessage([t.id, params]);
      }
    }
    return t;
  }

  addWindow(): MockWindow {
    const id = this._nextWindowId();
    const w = new MockWindow(id);
    this.mockWindows.push(w);
    if (this.currentWindowId < 0) {
      this.setCurrentWindow(w.id);
    }
    this.windows.onCreated.sendMessage([w, undefined]);
    return w;
  }

  removeWindow(windowId: number) {
    const index = this.mockWindows.findIndex(
      (mockWindow) => mockWindow.id === windowId,
    );
    if (index >= 0) {
      this.mockWindows = this.mockWindows.filter(
        (mockWindow) => mockWindow.id !== windowId,
      );
      this.windows.onRemoved.sendMessage([windowId, undefined]);
    }
    return this;
  }

  moveTabToWindow(tabId: number, targetWindowId?: number) {
    let t = this.getTab(tabId);
    if (targetWindowId === undefined) {
      targetWindowId = this.addWindow().id;
      this.setCurrentWindow(targetWindowId);
    }
    if (t && t.windowId !== targetWindowId) {
      t = this.removeTab(tabId, false);
      this.tabs.onDetached.sendMessage([
        t.id,
        { oldWindowId: t.windowId, oldPosition: t.position },
      ]);
      t = this.insertTab(t, targetWindowId);
      this.tabs.onAttached.sendMessage([
        t.id,
        { newWindowId: t.windowId, newPosition: t.position },
      ]);
    }
    return t;
  }

  moveTabToNewWindow(tabId: number) {
    return this.moveTabToWindow(tabId);
  }

  reloadTab(tabId: number) {
    const t = this.getTab(tabId);
    if (t) {
      const td = toIMockTabData(t);
      this.updateTab(t.id, { title: 'loading...' }, false);
      this.tabs.onUpdated.sendMessage([t.id, { status: 'loading' }]);
      this.updateTab(t.id, td, false);
      this.tabs.onUpdated.sendMessage([t.id, td]);
    }
    return t;
  }
}

export function getMockChrome() {
  const mc = new MockChrome();
  // @ts-ignore
  global.chrome = mc;
  return mc;
}
