import {
  addBookmark,
  convertAndGetAllBookmarkSavePayload,
  newEmptyAllBookmark,
  removeBookmark,
  updateBookmark,
  updateTabSpaceId,
} from '../AllBookmark';
import { newEmptyBookmark, setName, setUrl } from '../Bookmark';

function initAllBookmark() {
  const tabSpaceId = 'hello';
  let allBookmark = updateTabSpaceId(tabSpaceId, newEmptyAllBookmark());
  allBookmark = addBookmark(
    setUrl('https://www.test1.com', setName('bookmark 1', newEmptyBookmark())),
    allBookmark,
  );
  allBookmark = addBookmark(
    setUrl('https://www.test2.com', setName('bookmark 2', newEmptyBookmark())),
    allBookmark,
  );
  const b1 = allBookmark.bookmarks.get(0);
  const b2 = allBookmark.bookmarks.get(1);
  return { tabSpaceId, allBookmark, b1, b2 };
}

test('init', () => {
  const { tabSpaceId, allBookmark } = initAllBookmark();
  expect(allBookmark.bookmarks.size).toEqual(2);
  expect(allBookmark.tabSpaceId).toEqual(tabSpaceId);
  allBookmark.bookmarks.forEach((bookmark) => {
    expect(bookmark.tabSpaceId).toEqual(tabSpaceId);
  });
});

test('updateBookmark', () => {
  let { tabSpaceId, allBookmark, b1, b2 } = initAllBookmark();
  const changedName = b2.name + 'changed';
  allBookmark = updateBookmark('888', { name: changedName }, allBookmark);
  expect(allBookmark.bookmarks.toArray()).toEqual([b1, b2]);
  allBookmark = updateBookmark(b2.id, { name: changedName }, allBookmark);
  const i = allBookmark.bookmarks.findIndex(
    (bookmark) => bookmark.id === b2.id,
  );
  expect(allBookmark.bookmarks.get(i).name).toEqual(changedName);
});

test('removeBookmark', () => {
  let { allBookmark, b2 } = initAllBookmark();
  allBookmark = removeBookmark('888', allBookmark);
  expect(allBookmark.bookmarks.size).toEqual(2);
  allBookmark = removeBookmark(b2.id, allBookmark);
  expect(allBookmark.bookmarks.size).toEqual(1);
});

test('updateTabSpaceId', () => {
  let { tabSpaceId, allBookmark } = initAllBookmark();
  const newTabSpaceId = tabSpaceId + 'changed';
  allBookmark = updateTabSpaceId(newTabSpaceId, allBookmark);
  expect(allBookmark.tabSpaceId).toEqual(newTabSpaceId);
  allBookmark.bookmarks.forEach((bookmark) => {
    expect(bookmark.tabSpaceId).toEqual(newTabSpaceId);
  });
});

test('misc', () => {
  let { allBookmark } = initAllBookmark();
  const {
    allBookmark: savedAllBookmark,
    allBookmarkSavePayload,
    bookmarkSavePayloads,
  } = convertAndGetAllBookmarkSavePayload(allBookmark);
  expect(savedAllBookmark.bookmarks.toArray()).toEqual(bookmarkSavePayloads);
  expect(allBookmarkSavePayload.bookmarkIds).toEqual(
    bookmarkSavePayloads.map((bookmarkSavePayload) => bookmarkSavePayload.id),
  );
});
