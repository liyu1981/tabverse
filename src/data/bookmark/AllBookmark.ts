import { Bookmark, convertToSavedBookmark, setTabSpaceId } from './Bookmark';
import { IBase, isIdNotSaved } from '../common';
import {
  convertToSavedBase,
  inPlaceCopyFromOtherBase,
  newEmptyBase,
} from '../Base';

import { List } from 'immutable';
import { NotTabSpaceId } from '../common';
import { produce } from 'immer';

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

export function addBookmark(
  bookmark: Bookmark,
  targetAllBookmark: AllBookmark,
): AllBookmark {
  return produce(targetAllBookmark, (draft) => {
    draft.bookmarks = draft.bookmarks.push(
      setTabSpaceId(draft.tabSpaceId, bookmark),
    );
  });
}

export function updateBookmark(
  bid: string,
  changes: Partial<Bookmark>,
  targetAllBookmark: AllBookmark,
): AllBookmark {
  return produce(targetAllBookmark, (draft) => {
    const bIndex = draft.bookmarks.findIndex((bookmark) => bookmark.id === bid);
    if (bIndex >= 0) {
      const existBookmark = draft.bookmarks.get(bIndex);
      const newBookmark = {
        ...existBookmark,
        ...changes,
      };
      draft.bookmarks = draft.bookmarks.set(bIndex, newBookmark);
    }
  });
}

export function removeBookmark(
  bid: string,
  targetAllBookmark: AllBookmark,
): AllBookmark {
  return produce(targetAllBookmark, (draft) => {
    const bIndex = draft.bookmarks.findIndex((bookmark) => bookmark.id === bid);
    if (bIndex >= 0) {
      draft.bookmarks = draft.bookmarks.remove(bIndex);
    }
  });
}

export function updateTabSpaceId(
  tabSpaceId: string,
  targetAllBookmark: AllBookmark,
): AllBookmark {
  return produce(targetAllBookmark, (draft) => {
    draft.tabSpaceId = tabSpaceId;
    draft.bookmarks = draft.bookmarks
      .map((bookmark) => setTabSpaceId(tabSpaceId, bookmark))
      .toList();
  });
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
  const savedBase = convertToSavedBase(targetAllBookmark);
  const savedAllBookmark = produce(targetAllBookmark, (draft) => {
    inPlaceCopyFromOtherBase(draft, savedBase);
    draft.bookmarks = savedBookmarks;
  });
  const allBookmarkSavePayload = {
    ...savedBase,
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
