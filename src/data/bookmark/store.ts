import { createApi, createStore, forward } from 'effector';
import { merge } from 'lodash';
import { exposeDebugData } from '../../debug';
import { createGeneralStorageStoreAndApi } from '../../storage/GeneralStorage';
import { storageOverviewApi } from '../../storage/StorageOverview';
import {
  addBookmark,
  AllBookmark,
  removeBookmark,
  updateBookmark,
  updateTabSpaceId,
} from './AllBookmark';
import { newEmptyAllBookmark } from './AllBookmark';
import { Bookmark } from './Bookmark';

export const $allBookmark = createStore<AllBookmark>(newEmptyAllBookmark());

const allBookmarkApi = createApi($allBookmark, {
  update: (_lastAllBookmark, updatedAllBookmark: AllBookmark) =>
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
});

const { $store: $bookmarkStorageStore, api: bookmarkStorageApi } =
  createGeneralStorageStoreAndApi();
export const $bookmarkStorage = $bookmarkStorageStore;

forward({
  from: $bookmarkStorage,
  to: storageOverviewApi.updateBookmarkStorage,
});

export const bookmarkStoreApi = merge(allBookmarkApi, bookmarkStorageApi);

exposeDebugData('bookmark', { $allBookmark, $bookmarkStorageStore });
