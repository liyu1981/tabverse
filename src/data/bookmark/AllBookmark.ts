import { List } from 'immutable';
import { convertToSavedBase, newEmptyBase } from '../Base';
import { NotTabSpaceId } from '../chromeSession/ChromeSession';
import { IBase, isIdNotSaved } from '../common';
import {
  Bookmark,
  BookmarkLocalStorage,
  convertToSavedBookmark,
  newEmptyBookmark,
  setTabSpaceId,
} from './Bookmark';

export interface AllBookmark extends IBase {
  tabSpaceId: string;
  bookmarks: List<Bookmark>;
}

export interface AllBookmarkSavePayload extends IBase {
  tabSpaceId: string;
  bookmarkIds: string[];
}

export const ALLBOOKMARK_DB_TABLE_NAME = 'SavedAllBookmark';
export const ALLBOOKMARK_DB_SCHEMA = 'id, createdAt, tabSpaceId, *bookmarkIds';

export function newEmptyAllBookmark(): AllBookmark {
  return {
    ...newEmptyBase(),
    tabSpaceId: NotTabSpaceId,
    bookmarks: List(),
  };
}

export function cloneAllBookmark(targetAllBookmark: AllBookmark): AllBookmark {
  return {
    ...targetAllBookmark,
    bookmarks: List(targetAllBookmark.bookmarks),
  };
}

export function addBookmark(
  bookmark: Bookmark,
  targetAllBookmark: AllBookmark,
): AllBookmark {
  return {
    ...targetAllBookmark,
    bookmarks: targetAllBookmark.bookmarks.push(
      setTabSpaceId(targetAllBookmark.tabSpaceId, bookmark),
    ),
  };
}

export function updateBookmark(
  bid: string,
  changes: Partial<Bookmark>,
  targetAllBookmark: AllBookmark,
): AllBookmark {
  const bIndex = targetAllBookmark.bookmarks.findIndex(
    (bookmark) => bookmark.id === bid,
  );
  if (bIndex >= 0) {
    const existBookmark = targetAllBookmark.bookmarks.get(bIndex);
    const newBookmark = {
      ...existBookmark,
      ...changes,
    };
    return {
      ...targetAllBookmark,
      bookmarks: targetAllBookmark.bookmarks.set(bIndex, newBookmark),
    };
  } else {
    return cloneAllBookmark(targetAllBookmark);
  }
}

export function removeBookmark(
  bid: string,
  targetAllBookmark: AllBookmark,
): AllBookmark {
  const bIndex = targetAllBookmark.bookmarks.findIndex(
    (bookmark) => bookmark.id === bid,
  );
  if (bIndex >= 0) {
    return {
      ...targetAllBookmark,
      bookmarks: targetAllBookmark.bookmarks.remove(bIndex),
    };
  } else {
    return cloneAllBookmark(targetAllBookmark);
  }
}

export function updateTabSpaceId(
  tabSpaceId: string,
  targetAllBookmark: AllBookmark,
): AllBookmark {
  return {
    ...targetAllBookmark,
    tabSpaceId,
    bookmarks: targetAllBookmark.bookmarks
      .map((bookmark) => setTabSpaceId(tabSpaceId, bookmark))
      .toList(),
  };
}

export function getLocalStorageJSON(
  targetAllBookmark: AllBookmark,
): BookmarkLocalStorage[] {
  return targetAllBookmark.bookmarks
    .map((bookmark) => {
      return {
        name: bookmark.name,
        url: bookmark.url,
        favIconUrl: bookmark.favIconUrl,
      };
    })
    .toArray();
}

export function restoreFromLocalStorageJSON(
  bookmarkJSONs: BookmarkLocalStorage[],
  targetAllBookmark: AllBookmark,
): AllBookmark {
  return {
    ...targetAllBookmark,
    bookmarks: List(
      bookmarkJSONs.map((bookmarkJSON) => ({
        ...newEmptyBookmark(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tabSpaceId: targetAllBookmark.tabSpaceId,
        name: bookmarkJSON.name,
        url: bookmarkJSON.url,
        favIconUrl: bookmarkJSON.favIconUrl,
      })),
    ),
  };
}

export function convertAndGetAllBookmarkSavePayload(
  targetAllBookmark: AllBookmark,
): {
  allBookmark: AllBookmark;
  allBookmarkSavePayload: AllBookmarkSavePayload;
  isNewAllBookmark: boolean;
  newBookmarkSavePayloads: Bookmark[];
  existBookmarkSavePayloads: Bookmark[];
} {
  const isNewAllBookmark = isIdNotSaved(targetAllBookmark.id);
  const newBookmarkSavePayloads: Bookmark[] = [];
  const existBookmarkSavePayloads: Bookmark[] = [];
  const savedBookmarks = targetAllBookmark.bookmarks
    .map((bookmark) => {
      const isNewBookmark = isIdNotSaved(bookmark.id);
      const savedBookmark = convertToSavedBookmark(bookmark);
      if (isNewBookmark) {
        newBookmarkSavePayloads.push(savedBookmark);
      } else {
        existBookmarkSavePayloads.push(savedBookmark);
      }
      return savedBookmark;
    })
    .toList();
  const savedAllBookmark = {
    ...targetAllBookmark,
    ...convertToSavedBase(targetAllBookmark),
    bookmarks: savedBookmarks,
  };
  const allBookmarkSavePayload = {
    ...convertToSavedBase(targetAllBookmark),
    tabSpaceId: targetAllBookmark.tabSpaceId,
    bookmarkIds: savedBookmarks.map((bookmark) => bookmark.id).toArray(),
  };
  return {
    allBookmark: savedAllBookmark,
    allBookmarkSavePayload,
    isNewAllBookmark,
    newBookmarkSavePayloads,
    existBookmarkSavePayloads,
  };
}
