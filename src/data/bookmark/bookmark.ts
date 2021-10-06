import { Base, IBase, isIdNotSaved } from '../common';
import { action, makeObservable, observable } from 'mobx';
import { extend, merge } from 'lodash';

import { List } from 'immutable';

export interface IBookmark extends IBase {
  tabSpaceId: string;
  name: string;
  url: string;
  favIconUrl: string;
}

export type IBookmarkJSON = IBookmark;
export type IBookmarkSavePayload = IBookmarkJSON;

export class Bookmark extends Base implements IBookmark {
  tabSpaceId: string;
  name: string;
  url: string;
  favIconUrl: string;

  static DB_TABLE_NAME = 'SavedBookmark';
  static DB_SCHEMA = 'id, createdAt, tabSpaceId, name, url';

  constructor() {
    super();

    this.tabSpaceId = '';
    this.name = '';
    this.url = '';
    this.favIconUrl = '';
  }

  clone() {
    const b = new Bookmark();
    b.cloneAttributes(this);
    b.tabSpaceId = this.tabSpaceId;
    b.name = this.name;
    b.url = this.url;
    b.favIconUrl = this.favIconUrl;
    return b;
  }

  toJSON(): IBookmarkJSON {
    return extend(super.toJSON(), {
      tabSpaceId: this.tabSpaceId,
      name: this.name,
      url: this.url,
      favIconUrl: this.favIconUrl,
    });
  }

  static fromJSON(d: IBookmarkJSON): Bookmark {
    const b = new Bookmark();
    b.cloneAttributes(d);
    b.tabSpaceId = d.tabSpaceId;
    b.name = d.name;
    b.url = d.url;
    b.favIconUrl = d.favIconUrl;
    return b;
  }

  convertAndGetSavePayload(): IBookmarkSavePayload {
    this.convertToSaved();
    return this.toJSON();
  }
}

export interface IAllBookmarkSavePayload extends IBase {
  tabSpaceId: string;
  bookmarkIds: string[];
}

export class AllBookmark extends Base {
  tabSpaceId: string;
  bookmarks: List<Bookmark>;

  static DB_TABLE_NAME = 'SavedAllBookmark';
  static DB_SCHEMA = 'id, createdAt, tabSpaceId, *bookmarkIds';

  constructor(tabSpaceId: string) {
    super();

    makeObservable(
      this,
      extend(Base.getMakeObservableDef(), {
        bookmarks: observable,

        addBookmark: action,
        updateBookmark: action,
        removeBookmark: action,
        updateTabSpaceId: action,
        convertAndGetSavePayload: action,
      }),
    );

    this.tabSpaceId = tabSpaceId;
    this.bookmarks = List();
  }

  clone(): AllBookmark {
    const newAllBookmark = new AllBookmark(this.tabSpaceId);
    newAllBookmark.cloneAttributes(this);
    newAllBookmark.bookmarks = List(this.bookmarks);
    return newAllBookmark;
  }

  addBookmark(b: Bookmark) {
    b.tabSpaceId = this.tabSpaceId;
    this.bookmarks = this.bookmarks.push(b.clone().makeImmutable());
    return this;
  }

  updateBookmark(id: string, changes: Partial<Bookmark>) {
    const bIndex = this.bookmarks.findIndex((bookmark) => bookmark.id === id);
    if (bIndex >= 0) {
      const existBookmark = this.bookmarks.get(bIndex);
      const newBookmark = existBookmark.clone();
      merge(newBookmark, changes);
      this.bookmarks = this.bookmarks.set(bIndex, newBookmark.makeImmutable());
      return newBookmark;
    }
    return null;
  }

  removeBookmark(id: string) {
    const bIndex = this.bookmarks.findIndex((bookmark) => bookmark.id === id);
    if (bIndex >= 0) {
      const existBookmark = this.bookmarks.get(bIndex);
      this.bookmarks = this.bookmarks.remove(bIndex);
      return existBookmark;
    }
    return null;
  }

  updateTabSpaceId(newTabSpaceId: string) {
    this.tabSpaceId = newTabSpaceId;
    this.bookmarks = List(
      this.bookmarks.map((bookmark) => {
        const newBookmark = bookmark.clone();
        newBookmark.tabSpaceId = newTabSpaceId;
        return newBookmark.makeImmutable();
      }),
    );
    return this;
  }

  static fromSavedData(data: IAllBookmarkSavePayload) {
    const allBookmark = new AllBookmark(data.tabSpaceId);
    allBookmark.cloneAttributes(data);
    return allBookmark;
  }

  convertAndGetSavePayload(): {
    allBookmarkSavePayload: IAllBookmarkSavePayload;
    isNewAllBookmark: boolean;
    newBookmarkSavePayloads: IBookmarkSavePayload[];
    existBookmarkSavePayloads: IBookmarkSavePayload[];
  } {
    const isNewAllBookmark = isIdNotSaved(this.id);
    this.convertToSaved();
    const newBookmarkSavePayloads: IBookmarkSavePayload[] = [];
    const existBookmarkSavePayloads: IBookmarkSavePayload[] = [];
    this.bookmarks = List(
      this.bookmarks.map((bookmark) => {
        const savedBookmark = bookmark.clone();
        const isNewBookmark = isIdNotSaved(savedBookmark.id);
        const bookmarkSavePayload = savedBookmark.convertAndGetSavePayload();
        if (isNewBookmark) {
          newBookmarkSavePayloads.push(bookmarkSavePayload);
        } else {
          existBookmarkSavePayloads.push(bookmarkSavePayload);
        }
        return savedBookmark.makeImmutable();
      }),
    );
    return {
      allBookmarkSavePayload: extend(super.toJSON(), {
        tabSpaceId: this.tabSpaceId,
        bookmarkIds: this.bookmarks.map((bookmark) => bookmark.id).toArray(),
      }),
      isNewAllBookmark,
      newBookmarkSavePayloads,
      existBookmarkSavePayloads,
    };
  }
}
