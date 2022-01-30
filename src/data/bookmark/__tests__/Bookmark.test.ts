import { AllBookmark, Bookmark } from '../Bookmark';

import { isIdNotSaved } from '../../common';

function initAllBookmark() {
  const tabSpaceId = 'hello';
  const allBookmark = new AllBookmark(tabSpaceId);
  const b1 = new Bookmark();
  b1.name = 'bookmark 1';
  b1.url = 'https://www.test1.com';
  const b2 = new Bookmark();
  b2.name = 'bookmark 2';
  b2.url = 'https://www.test2.com';
  allBookmark.addBookmark(b1);
  allBookmark.addBookmark(b2);
  return { tabSpaceId, allBookmark, b1, b2 };
}

test('init', () => {
  const { tabSpaceId, allBookmark, b1, b2 } = initAllBookmark();
  expect(allBookmark.bookmarks.size).toEqual(2);
  expect(allBookmark.tabSpaceId).toEqual(tabSpaceId);
  allBookmark.bookmarks.forEach((bookmark) =>
    expect(bookmark.tabSpaceId).toEqual(tabSpaceId),
  );
});

test('updateBookmark', () => {
  const { tabSpaceId, allBookmark, b1, b2 } = initAllBookmark();
  const b3 = b2.clone();
  b3.name = b2.name + 'changed';
  expect(allBookmark.updateBookmark('888', b3)).toBeNull();
  allBookmark.updateBookmark(b2.id, b3);
  const i = allBookmark.bookmarks.findIndex(
    (bookmark) => bookmark.id === b2.id,
  );
  expect(allBookmark.bookmarks.get(i).name).toEqual(b3.name);
});

test('removeBookmark', () => {
  const { tabSpaceId, allBookmark, b1, b2 } = initAllBookmark();
  expect(allBookmark.removeBookmark('888')).toBeNull();
  allBookmark.removeBookmark(b2.id);
  expect(allBookmark.bookmarks.size).toEqual(1);
});

test('updateTabSpaceId', () => {
  const { tabSpaceId, allBookmark, b1, b2 } = initAllBookmark();
  const newTabSpaceId = tabSpaceId + 'changed';
  allBookmark.updateTabSpaceId(newTabSpaceId);
  expect(allBookmark.tabSpaceId).toEqual(newTabSpaceId);
  allBookmark.bookmarks.forEach((bookmark) =>
    expect(bookmark.tabSpaceId).toEqual(newTabSpaceId),
  );
});

test('misc', () => {
  const { tabSpaceId, allBookmark, b1, b2 } = initAllBookmark();
  const {
    allBookmarkSavePayload,
    isNewAllBookmark,
    newBookmarkSavePayloads,
    existBookmarkSavePayloads,
  } = allBookmark.convertAndGetSavePayload();
  allBookmarkSavePayload.bookmarkIds.forEach((bookmarkId) =>
    expect(isIdNotSaved(bookmarkId)).toBeFalsy(),
  );
  expect(isNewAllBookmark).toBeTruthy();
  expect(allBookmarkSavePayload.bookmarkIds).toEqual(
    newBookmarkSavePayloads.map(
      (bookmarkSavePayload) => bookmarkSavePayload.id,
    ),
  );
  expect(existBookmarkSavePayloads.length).toEqual(0);
});
