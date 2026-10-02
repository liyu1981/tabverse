import { $allBookmark, bookmarkStoreApi } from './store';
import {
  ALLBOOKMARK_DB_TABLE_NAME,
  AllBookmark,
  AllBookmarkSavePayload,
  addBookmark,
  convertAndGetAllBookmarkSavePayload,
  newEmptyAllBookmark,
  updateTabSpaceId,
} from './AllBookmark';
import { BOOKMARK_DB_TABLE_NAME, Bookmark } from './Bookmark';
import { addPagingToQueryParams, db } from '../../storage/db';
import { debounce } from '../../global';
import { DEFAULT_SAVE_DEBOUNCE } from '../../storage/StorageOverview';
import { updateFromSaved } from '../Base';

export async function loadAllBookmarkByTabSpaceId(tabSpaceId: string) {
  const loadedAllBookmark = await queryAllBookmark(
    tabSpaceId,
    addPagingToQueryParams({}),
  );
  bookmarkStoreApi.update(loadedAllBookmark);
}

export async function queryAllBookmark(
  tabSpaceId: string,
  _params?: any,
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
    bookmarksData.forEach((bookmarkData) => {
      allBookmark = addBookmark(bookmarkData, allBookmark);
    });
    return allBookmark;
  }
}

export async function saveAllBookmark(): Promise<number> {
  // super stupid saving strategy: save them all when needed
  const updatedAt = await db.transaction(
    'rw',
    [db.table(BOOKMARK_DB_TABLE_NAME), db.table(ALLBOOKMARK_DB_TABLE_NAME)],
    async (_tx) => {
      const { allBookmark, allBookmarkSavePayload, bookmarkSavePayloads } =
        convertAndGetAllBookmarkSavePayload($allBookmark.getState());
      await db.table(BOOKMARK_DB_TABLE_NAME).bulkPut(bookmarkSavePayloads);
      await db.table(ALLBOOKMARK_DB_TABLE_NAME).put(allBookmarkSavePayload);
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

export const saveCurrentBookmarks = () => {
  // a tabverse is born saved (its id is minted when the tab is opened), so
  // there is no "not saved yet" state to fall back to
  saveCurrentAllBookmark();
};
