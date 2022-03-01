import {
  AllBookmark,
  Bookmark,
  IAllBookmarkSavePayload,
  IBookmarkJSON,
  IBookmarkLocalStorage,
} from './Bookmark';
import {
  DEFAULT_SAVE_DEBOUNCE,
  InSavingStatus,
  SavedStore,
} from '../../store/store';
import {
  TabSpaceDBMsg,
  TabSpaceMsg,
  subscribePubSubMessage,
} from '../../message/message';
import { debounce, logger } from '../../global';

import { IDatabaseChange } from 'dexie-observable/api';
import { db } from '../../store/db';
import { getAllBookmarkData } from './bootstrap';
import { getTabSpaceData } from '../tabSpace/bootstrap';
import { observe } from 'mobx';
import {
  getLocalStorageKey,
  localStorageAddListener,
  localStorageGetItem,
  localStoragePutItem,
  localStorageRemoveListener,
} from '../../store/localStorageWrapper';

export const LOCALSTORAGE_BOOKMARK_KEY = getLocalStorageKey('bookmark');

export class SavedBookmarkStore extends SavedStore {}

export function monitorDbChanges(savedStore: SavedBookmarkStore) {
  subscribePubSubMessage(
    TabSpaceDBMsg.Changed,
    (message, data: IDatabaseChange[]) => {
      logger.log('pubsub:', message, data);
      data.forEach((d) => {
        if (d.table === Bookmark.DB_TABLE_NAME) {
          savedStore.increaseSavedDataVersion();
        }
      });
    },
  );
}

export function monitorTabSpaceChanges(allBookmark: AllBookmark) {
  subscribePubSubMessage(TabSpaceMsg.ChangeID, (message, data) => {
    logger.log('pubsub:', message, data);
    const { to } = data;
    allBookmark.updateTabSpaceId(to);
  });
}

export function startMonitorLocalStorageChanges(allBookmark: AllBookmark) {
  localStorageAddListener(
    LOCALSTORAGE_BOOKMARK_KEY,
    (key, newValue, oldValue) => {
      const bookmarkJSONs = JSON.parse(newValue) as IBookmarkLocalStorage[];
      allBookmark.restoreFromLocalStorageJSON(bookmarkJSONs);
    },
  );
  // immediately load once after the monitoring is started
  localStorageGetItem(LOCALSTORAGE_BOOKMARK_KEY, (value: string) => {
    const bookmarkJSONs = JSON.parse(value) as IBookmarkLocalStorage[];
    allBookmark.restoreFromLocalStorageJSON(bookmarkJSONs);
  });
}

export function stopMonitorLocalStorageChanges() {
  localStorageRemoveListener(LOCALSTORAGE_BOOKMARK_KEY);
}

export function monitorAllBookmarkChange(
  allBookmark: AllBookmark,
  savedBookmarkStore: SavedBookmarkStore,
) {
  observe(allBookmark, (change) => {
    logger.log('allBookmark changed:', change);
    if (savedBookmarkStore.inSaving === InSavingStatus.InSaving) {
      logger.log('bookmark in saving, skip');
    } else {
      if (getTabSpaceData().tabSpace.needAutoSave()) {
        logger.log(
          'curent tabSpace need autoSave, will then saveCurrentAllBookmark',
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

export function monitorBookmarkChange(
  allBookmark: AllBookmark,
  savedBookmarkStore: SavedBookmarkStore,
) {
  observe(allBookmark, (change) => {
    logger.log('allBookmark changed:', change);
  });
}

export async function querySavedBookmarkCount(
  savedBookmarkStore: SavedBookmarkStore,
  tabSpaceId: string,
) {
  const total = await db
    .table(Bookmark.DB_TABLE_NAME)
    .where('tabSpaceId')
    .equals(tabSpaceId)
    .count();
  savedBookmarkStore.updateTotalSavedCount(total);
}

export async function queryAllBookmark(
  tabSpaceId: string,
  params?: any,
): Promise<AllBookmark> {
  const allBookmarksData: IAllBookmarkSavePayload[] = await db
    .table(AllBookmark.DB_TABLE_NAME)
    .where('tabSpaceId')
    .equals(tabSpaceId)
    .toArray();

  if (allBookmarksData.length <= 0) {
    return new AllBookmark(tabSpaceId);
  } else {
    const allBookmark = AllBookmark.fromSavedData(allBookmarksData[0]);
    const bookmarksData: IBookmarkJSON[] = await db
      .table(Bookmark.DB_TABLE_NAME)
      .bulkGet(allBookmarksData[0].bookmarkIds);
    bookmarksData.forEach((bookmarkData) =>
      allBookmark.addBookmark(Bookmark.fromJSON(bookmarkData)),
    );
    return allBookmark;
  }
}

export async function saveAllBookmark(
  allBookmark: AllBookmark,
): Promise<number> {
  // super stupid saving strategy: save them all when needed
  await db.transaction(
    'rw',
    [db.table(Bookmark.DB_TABLE_NAME), db.table(AllBookmark.DB_TABLE_NAME)],
    async (tx) => {
      const {
        allBookmarkSavePayload,
        isNewAllBookmark,
        newBookmarkSavePayloads,
        existBookmarkSavePayloads,
      } = allBookmark.convertAndGetSavePayload();
      await db.table(Bookmark.DB_TABLE_NAME).bulkAdd(newBookmarkSavePayloads);
      await db.table(Bookmark.DB_TABLE_NAME).bulkPut(existBookmarkSavePayloads);
      if (isNewAllBookmark) {
        await db.table(AllBookmark.DB_TABLE_NAME).add(allBookmarkSavePayload);
      } else {
        await db.table(AllBookmark.DB_TABLE_NAME).put(allBookmarkSavePayload);
      }
    },
  );
  return Date.now();
}

const saveCurrentAllBookmarkImpl = async () => {
  const { allBookmark, savedBookmarkStore } = getAllBookmarkData();
  savedBookmarkStore.markInSaving(true);
  const savedTime = await saveAllBookmark(allBookmark);
  savedBookmarkStore.markInSaving(false, savedTime);
};

export const saveCurrentAllBookmark = debounce(
  saveCurrentAllBookmarkImpl,
  DEFAULT_SAVE_DEBOUNCE,
);

export const saveCurrentAllBookmarkToLocalStorage = () => {
  const { allBookmark } = getAllBookmarkData();
  localStoragePutItem(
    LOCALSTORAGE_BOOKMARK_KEY,
    JSON.stringify(allBookmark.getLocalStorageJSON()),
  );
};
