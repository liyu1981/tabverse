import { Base, IBase, getUnsavedNewId, isIdNotSaved } from '../common';
import { ISavedTab, Tab, TabJSON } from './Tab';
import { action, computed, makeObservable, observable } from 'mobx';
import { assign, extend, isEqual, omit } from 'lodash';

import { List } from 'immutable';
import { TabSpaceStub } from './TabSpaceRegistry';
import { strict as assert } from 'assert';

export interface ISavedTabSpace extends IBase {
  name: string;
  tabIds: string[];
}

export interface ILiveTabSpace {
  chromeTabId: number;
  chromeWindowId: number;
}

export type TabSpaceJSON = Omit<ISavedTabSpace, 'tabIds'> & {
  tabs: TabJSON[];
} & ILiveTabSpace;

export class TabSpace extends Base implements ILiveTabSpace {
  name: string;
  tabs: List<Tab>;
  chromeTabId: number;
  chromeWindowId: number;

  static DB_TABLE_NAME = 'SavedTabSpace';
  static DB_SCHEMA = 'id, name, *tabIds, windowId, createdAt';

  constructor(chromeTabId?: number, chromeWindowId?: number, newId?: string) {
    super(newId ?? getUnsavedNewId());

    makeObservable(
      this,
      extend(Base.getMakeObservableDef(), {
        name: observable,
        tabs: observable,
        chromeTabId: observable,
        chromeWindowId: observable,

        tabIds: computed,

        setChromeTabAndWindowId: action,
        reset: action,
        addTab: action,
        addTabs: action,
        updateTab: action,
        removeTab: action,
        removeTabById: action,
        removeTabByChromeTabId: action,
        replaceTab: action,
        replaceTabs: action,
        update: action,
        convertAndGetSavePayload: action,
      }),
    );

    this.name =
      chromeWindowId && chromeWindowId >= 0 ? `Window-${chromeWindowId}` : '';
    this.tabs = List();
    this.chromeTabId = chromeTabId ?? -1;
    this.chromeWindowId = chromeWindowId ?? -1;
  }

  get tabIds(): string[] {
    return this.tabs.map((tab) => tab.id).toArray();
  }

  needAutoSave() {
    return !isIdNotSaved(this.id);
  }

  clone(): TabSpace {
    const newts = new TabSpace(this.chromeTabId, this.chromeWindowId);
    newts.cloneAttributes(this);
    newts.name = this.name;
    newts.chromeTabId = this.chromeTabId;
    newts.chromeWindowId = this.chromeWindowId;
    newts.tabs = List(this.tabs);
    return newts;
  }

  isEqual(other: TabSpace): boolean {
    return isEqual(this.toJSON(), other.toJSON());
  }

  toJSON(): TabSpaceJSON {
    return extend(super.toJSON(), {
      name: this.name,
      tabs: this.tabs.map((tab) => tab.toJSON()).toArray(),
      chromeTabId: this.chromeTabId,
      chromeWindowId: this.chromeWindowId,
    });
  }

  static fromJSON(tsJSON: TabSpaceJSON) {
    const ts = new TabSpace();
    ts.cloneAttributes(tsJSON);
    ts.name = tsJSON.name;
    ts.tabs = List(tsJSON.tabs.map((tabJson) => Tab.fromJSON(tabJson)));
    ts.chromeTabId = tsJSON.chromeTabId;
    ts.chromeWindowId = tsJSON.chromeWindowId;
    return ts;
  }

  static fromSavedDataWithoutTabs(d: ISavedTabSpace) {
    const ts = new TabSpace();
    ts.cloneAttributes(d);
    ts.name = d.name;
    return ts;
  }

  reset(chromeTabId?: number, chromeWindowId?: number, newId?: string) {
    this.chromeTabId = chromeTabId ?? -1;
    this.chromeWindowId = chromeWindowId ?? -1;
    this.id = newId ?? getUnsavedNewId();
    this.tabs = List();
    return this;
  }

  setChromeTabAndWindowId(
    tabId: number,
    windowId: number,
    autoSetName = false,
  ) {
    this.chromeTabId = tabId;
    this.chromeWindowId = windowId;
    if (autoSetName) {
      this.name = `tabverse-${windowId}`;
    }
  }

  _findTabIndexById(id: string): number {
    return this.tabs.findIndex((tab) => tab.id === id);
  }

  findTabById(id: string): Tab | undefined {
    return this.tabs.find((tab) => tab.id === id);
  }

  findTabByChromeTabId(id: number): Tab | undefined {
    return this.tabs.find((tab) => tab.chromeTabId === id);
  }

  addTab(t: Tab, index?: number) {
    const newTab = t.clone();
    newTab.tabSpaceId = this.id;
    if (index && index >= 0 && index < this.tabs.size) {
      this.tabs = this.tabs.insert(index, newTab.makeImmutable());
    } else if (index && index < 0) {
      this.tabs = this.tabs.insert(0, newTab.makeImmutable());
    } else if (index && index >= this.tabs.size) {
      this.tabs = this.tabs.push(newTab.makeImmutable());
    } else {
      this.tabs = this.tabs.push(newTab.makeImmutable());
    }
    return this;
  }

  addTabs(tabs: Tab[]) {
    tabs.forEach((tab) => this.addTab(tab));
    return this;
  }

  updateTab(t: Tab): boolean {
    const index = this._findTabIndexById(t.id);
    const oldTab = this.tabs.get(index);
    if (!isEqual(oldTab.toJSON(), t.toJSON())) {
      this.tabs = this.tabs.set(index, t.clone().makeImmutable());
      return true;
    }
    return false;
  }

  _removeTabByIndex(index: number): Tab | null {
    if (index >= 0) {
      const oldTab = this.tabs.get(index);
      this.tabs = this.tabs.remove(index);
      return oldTab;
    }
    return null;
  }

  removeTab(t: Tab): Tab | null {
    const index = this._findTabIndexById(t.id);
    return this._removeTabByIndex(index);
  }

  removeTabById(id: string): Tab | null {
    const index = this._findTabIndexById(id);
    return this._removeTabByIndex(index);
  }

  removeTabByChromeTabId(chromeTabId: number): Tab | null {
    const index = this.tabs.findIndex((tab) => tab.chromeTabId === chromeTabId);
    return this._removeTabByIndex(index);
  }

  replaceTab(fromTid: string, toTid: string, tab: Tab) {
    const index = this._findTabIndexById(fromTid);
    if (index >= 0) {
      const t = tab.clone();
      t.id = toTid;
      this.tabs = this.tabs.set(index, t.makeImmutable());
    } else {
      this.tabs = this.tabs.push(tab.clone().makeImmutable());
    }
    return this;
  }

  replaceTabs(tabs: Tab[]) {
    this.tabs = List();
    tabs.forEach((tab) => this.addTab(tab));
    return this;
  }

  convertAndGetSavePayload(): {
    tabSpaceSavePayload: ISavedTabSpace;
    isNewTabSpace: boolean;
    newTabSavePayloads: ISavedTab[];
    existTabSavePayloads: ISavedTab[];
  } {
    const isNewTabSpace = isIdNotSaved(this.id);
    const existTabSavePayloads: ISavedTab[] = [];
    const newTabSavePayloads: ISavedTab[] = [];
    this.tabs = List(
      this.tabs.map((tab: Tab) => {
        const isNewTab = isIdNotSaved(tab.id);
        const [savedTab, tabPayload] = tab.convertAndGetSavePayload();
        if (isNewTab) {
          newTabSavePayloads.push(tabPayload);
        } else {
          existTabSavePayloads.push(tabPayload);
        }
        return savedTab;
      }),
    );
    this.convertToSaved();
    return {
      tabSpaceSavePayload: extend(super.toJSON(), {
        name: this.name,
        tabIds: this.tabIds,
      }),
      isNewTabSpace,
      newTabSavePayloads,
      existTabSavePayloads,
    };
  }

  update(params: Partial<Omit<ISavedTabSpace, 'tabIds'>>) {
    assert(!('tabIds' in params), 'update tabIds with updateTabIds');
    assign(this, omit(params, 'tabIds'));
    return this;
  }

  toTabSpaceStub(): TabSpaceStub {
    return extend(super.toJSON(), {
      name: this.name,
      chromeTabId: this.chromeTabId,
      chromeWindowId: this.chromeWindowId,
    });
  }
}
