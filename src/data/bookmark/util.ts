import { isArray } from 'lodash';
import { isJestTest } from '../../debug';
import { debounce, logger } from '../../global';
import { subscribePubSubMessage, TabSpaceMsg } from '../../message/message';
import { db } from '../../store/db';
import {
  getLocalStorageKey,
  localStorageAddListener,
  localStorageGetItem,
  localStoragePutItem,
  localStorageRemoveListener,
} from '../../store/localStorageWrapper';
import {
  addPagingToQueryParams,
  DEFAULT_SAVE_DEBOUNCE,
} from '../../store/storage';
import { updateFromSaved } from '../Base';
import { isIdNotSaved } from '../common';
import { InSavingStatus } from '../storage/Storage';
import { $tabSpace } from '../tabSpace/store';
import { needAutoSave } from '../tabSpace/TabSpace';
import {
  addBookmark,
  AllBookmark,
  AllBookmarkSavePayload,
  ALLBOOKMARK_DB_TABLE_NAME,
  convertAndGetAllBookmarkSavePayload,
  newEmptyAllBookmark,
  updateTabSpaceId,
} from './AllBookmark';
import {
  Bookmark,
  BookmarkLocalStorage,
  BOOKMARK_DB_TABLE_NAME,
} from './Bookmark';
import { $allBookmark, $bookmarkStorage, bookmarkStoreApi } from './store';

export const LOCALSTORAGE_BOOKMARK_KEY = getLocalStorageKey('bookmark');

export function monitorTabSpaceChanges() {
  subscribePubSubMessage(TabSpaceMsg.ChangeID, (message, data) => {
    logger.log('pubsub:', message, data);
    const { to } = data;
    bookmarkStoreApi.updateTabSpaceId(to);
  });
}

export async function loadAllBookmarkByTabSpaceId(tabSpaceId: string) {
  if (isIdNotSaved(tabSpaceId) && !isJestTest()) {
    await loadCurrentAllBookmarkFromLocalStorage();
  } else {
    const loadedAllBookmark = await queryAllBookmark(
      tabSpaceId,
      addPagingToQueryParams({}),
    );
    bookmarkStoreApi.update(loadedAllBookmark);
  }
}

export async function loadCurrentAllBookmarkFromLocalStorage() {
  return new Promise<void>((resolve, reject) =>
    localStorageGetItem(LOCALSTORAGE_BOOKMARK_KEY, (value: string) => {
      const bookmarkJSONs = JSON.parse(value) as BookmarkLocalStorage[];
      if (isArray(bookmarkJSONs)) {
        bookmarkStoreApi.restoreFromLocalStorageJSON(bookmarkJSONs);
      }
      resolve();
    }),
  );
}

export function startMonitorLocalStorageChanges() {
  localStorageAddListener(
    LOCALSTORAGE_BOOKMARK_KEY,
    (key, newValue, oldValue) => {
      const bookmarkJSONs = JSON.parse(newValue) as BookmarkLocalStorage[];
      if (isArray(bookmarkJSONs)) {
        bookmarkStoreApi.restoreFromLocalStorageJSON(bookmarkJSONs);
      }
    },
  );
  // immediately load once after the monitoring is started
  loadCurrentAllBookmarkFromLocalStorage();
}

export function stopMonitorLocalStorageChanges() {
  localStorageRemoveListener(LOCALSTORAGE_BOOKMARK_KEY);
}

export function monitorAllBookmarkChanges() {
  $allBookmark.watch((currentAllBookmark) => {
    logger.log('allBookmark changed:', currentAllBookmark);
    if ($bookmarkStorage.getState().inSaving === InSavingStatus.InSaving) {
      logger.log('bookmark in saving, skip');
    } else {
      if (needAutoSave($tabSpace.getState())) {
        logger.log(
          'current tabSpace need autoSave, will then saveCurrentAllBookmark',
        );
        saveCurrentAllBookmark();
      } else {
        logger.log(
          'current tabSpace is not on autoSave, will then save bookmarks to localStorage',
        );
        saveCurrentAllBookmarkToLocalStorage();
      }
    }
  });
}

export async function queryAllBookmark(
  tabSpaceId: string,
  params?: any,
): Promise<AllBookmark> {
  const allBookmarksData = await db
    .table<AllBookmarkSavePayload>(ALLBOOKMARK_DB_TABLE_NAME)
    .where('tabSpaceId')
    .equals(tabSpaceId)
    .toArray();
  if (allBookmarksData.length <= 0) {
    return updateTabSpaceId(tabSpaceId, newEmptyAllBookmark());
  } else {
    const savedAllBookmark = allBookmarksData[0];
    let allBookmark = updateTabSpaceId(
      savedAllBookmark.tabSpaceId,
      updateFromSaved(savedAllBookmark, newEmptyAllBookmark()),
    );
    const bookmarksData = await db
      .table<Bookmark>(BOOKMARK_DB_TABLE_NAME)
      .bulkGet(savedAllBookmark.bookmarkIds);
    bookmarksData.forEach(
      (bookmarkData) => (allBookmark = addBookmark(bookmarkData, allBookmark)),
    );
    return allBookmark;
  }
}

export async function saveAllBookmark(): Promise<number> {
  // super stupid saving strategy: save them all when needed
  const updatedAt = await db.transaction(
    'rw',
    [db.table(BOOKMARK_DB_TABLE_NAME), db.table(ALLBOOKMARK_DB_TABLE_NAME)],
    async (tx) => {
      const {
        allBookmark,
        allBookmarkSavePayload,
        isNewAllBookmark,
        newBookmarkSavePayloads,
        existBookmarkSavePayloads,
      } = convertAndGetAllBookmarkSavePayload($allBookmark.getState());
      await db.table(BOOKMARK_DB_TABLE_NAME).bulkAdd(newBookmarkSavePayloads);
      await db.table(BOOKMARK_DB_TABLE_NAME).bulkPut(existBookmarkSavePayloads);
      if (isNewAllBookmark) {
        await db.table(ALLBOOKMARK_DB_TABLE_NAME).add(allBookmarkSavePayload);
      } else {
        await db.table(ALLBOOKMARK_DB_TABLE_NAME).put(allBookmarkSavePayload);
      }
      bookmarkStoreApi.update(allBookmark);
      return allBookmarkSavePayload.updatedAt;
    },
  );
  return updatedAt;
}

const saveCurrentAllBookmarkImpl = async () => {
  bookmarkStoreApi.markInSaving(true);
  const savedTime = await saveAllBookmark();
  bookmarkStoreApi.updateLastSavedTime(savedTime);
  bookmarkStoreApi.markInSaving(false);
};

export const saveCurrentAllBookmark = debounce(
  saveCurrentAllBookmarkImpl,
  DEFAULT_SAVE_DEBOUNCE,
);

export function saveCurrentAllBookmarkToLocalStorage() {
  localStoragePutItem(
    LOCALSTORAGE_BOOKMARK_KEY,
    JSON.stringify($allBookmark.getState()),
  );
}
