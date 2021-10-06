import { Base, IBase, getUnsavedNewId } from '../common';

import { extend } from 'lodash';

export interface ISavedTab extends IBase {
  tabSpaceId: string;
  title: string;
  url: string;
  favIconUrl: string;
  pinned: boolean;
  suspended: boolean;
}

export interface ILiveTab {
  chromeTabId?: number;
  chromeWindowId?: number;
}

export type TabJSON = ISavedTab & ILiveTab;

export class Tab extends Base implements ISavedTab, ILiveTab {
  tabSpaceId: string;
  title: string;
  url: string;
  favIconUrl: string;
  pinned: boolean;
  suspended: boolean;
  chromeTabId?: number;
  chromeWindowId?: number;

  static DB_TABLE_NAME = 'SavedTab';
  static DB_SCHEMA = 'id, title, url, createdAt';

  constructor(newId?: string) {
    super(newId ?? getUnsavedNewId());

    this.favIconUrl = '';
    this.pinned = false;
    this.suspended = false;
  }

  clone() {
    const newTab = new Tab(this.id);
    newTab.cloneAttributes(this);
    newTab.tabSpaceId = this.tabSpaceId;
    newTab.title = this.title;
    newTab.url = this.url;
    newTab.favIconUrl = this.favIconUrl;
    newTab.pinned = this.pinned;
    newTab.suspended = this.suspended;
    newTab.chromeTabId = this.chromeTabId;
    newTab.chromeWindowId = this.chromeWindowId;
    return newTab;
  }

  toJSON(): TabJSON {
    return extend(super.toJSON(), {
      tabSpaceId: this.tabSpaceId,
      title: this.title,
      url: this.url,
      favIconUrl: this.favIconUrl,
      pinned: this.pinned,
      suspended: this.suspended,
      chromeTabId: this.chromeTabId ?? -1,
      chromeWindowId: this.chromeWindowId ?? -1,
    });
  }

  static fromJSON(tJSON: TabJSON) {
    const t = new Tab();
    t.cloneAttributes(tJSON);
    t.tabSpaceId = tJSON.tabSpaceId;
    t.title = tJSON.title;
    t.url = tJSON.url;
    t.favIconUrl = tJSON.favIconUrl;
    t.pinned = tJSON.pinned;
    t.suspended = tJSON.suspended;
    t.chromeTabId = tJSON.chromeTabId;
    t.chromeWindowId = tJSON.chromeWindowId;
    return t;
  }

  static fromSavedData(ist: ISavedTab): Tab {
    const t = new Tab();
    t.cloneAttributes(ist);
    t.tabSpaceId = ist.tabSpaceId;
    t.title = ist.title;
    t.url = ist.url;
    t.favIconUrl = ist.favIconUrl;
    t.pinned = ist.pinned;
    t.suspended = ist.suspended;
    return t;
  }

  convertAndGetSavePayload(): [Tab, ISavedTab] {
    const savedTab = this.clone();
    savedTab.convertToSaved();
    return [
      savedTab,
      extend(savedTab.toJSON(), {
        tabSpaceId: savedTab.tabSpaceId,
        title: savedTab.title,
        url: savedTab.url,
        favIconUrl: savedTab.favIconUrl,
        pinned: savedTab.pinned,
        suspended: savedTab.suspended,
      }),
    ];
  }

  static fromILiveTab(ilt: ILiveTab): Tab {
    const t = new Tab();
    t.chromeTabId = ilt.chromeTabId;
    t.chromeWindowId = ilt.chromeWindowId;
    return t;
  }
}
