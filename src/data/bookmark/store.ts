import { createApi, createStore } from 'effector';
import { merge } from 'lodash';
import { exposeDebugData } from '../../debug';
import { createGeneralStorageStoreAndApi } from '../storage/store';
import {
  addBookmark,
  AllBookmark,
  removeBookmark,
  restoreFromLocalStorageJSON,
  updateBookmark,
  updateTabSpaceId,
} from './AllBookmark';
import { newEmptyAllBookmark } from './AllBookmark';
import { Bookmark, BookmarkLocalStorage } from './Bookmark';

export const $allBookmark = createStore<AllBookmark>(newEmptyAllBookmark());
export type BookmarkStore = typeof $allBookmark;

const allBookmarkApi = createApi($allBookmark, {
  update: (lastAllBookmark, updatedAllBookmark: AllBookmark) =>
    updatedAllBookmark,
  updateTabSpaceId: (lastAllBookmark, tabSpaceId: string) =>
    updateTabSpaceId(tabSpaceId, lastAllBookmark),
  addBookmark: (lastAllBookmark, bookmark: Bookmark) =>
    addBookmark(bookmark, lastAllBookmark),
  updateBookmark: (
    lastAllBookmark,
    { bid, changes }: { bid: string; changes: Partial<Bookmark> },
  ) => updateBookmark(bid, changes, lastAllBookmark),
  removeBookmark: (lastAllBookmark, bid: string) =>
    removeBookmark(bid, lastAllBookmark),
  restoreFromLocalStorageJSON: (
    lastAllBookmark,
    bookmarkJSONs: BookmarkLocalStorage[],
  ) => restoreFromLocalStorageJSON(bookmarkJSONs, lastAllBookmark),
});

const { $store: $bookmarkStorageStore, api: bookmarkStorageApi } =
  createGeneralStorageStoreAndApi();
export const $bookmarkStorage = $bookmarkStorageStore;
export type BookmarkStorage = typeof $bookmarkStorageStore;

export const bookmarkStoreApi = merge(allBookmarkApi, bookmarkStorageApi);

exposeDebugData('bookmark', { $allBookmark, $bookmarkStorageStore });
