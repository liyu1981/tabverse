import { bootstrap, getAllBookmarkData, loadByTabSpaceId } from '../bootstrap';
import {
  getTabSpaceData,
  bootstrap as tabSpaceBootstrap,
} from '../../tabSpace/bootstrap';
import {
  queryAllBookmark,
  saveCurrentAllBookmark,
} from '../SavedBookmarkStore';

import { Bookmark } from '../Bookmark';
import { initTabSpaceData } from '../../tabSpace/__tests__/SavedTabSpaceStore.test';

async function bootstrapAllBookmark() {
  const { tst1 } = await initTabSpaceData();
  await tabSpaceBootstrap(tst1.id, tst1.windowId);
  const tabSpaceId = getTabSpaceData().tabSpace.id;
  bootstrap();
  await loadByTabSpaceId(tabSpaceId);
  return { tabSpaceId };
}

test('all', async () => {
  const { tabSpaceId } = await bootstrapAllBookmark();
  expect(getAllBookmarkData().allBookmark.bookmarks.size).toEqual(0);
  expect(getAllBookmarkData().allBookmark.tabSpaceId).toEqual(tabSpaceId);

  const b1 = new Bookmark();
  b1.name = 'test 1';
  b1.url = 'https://www.test1.com';
  const b2 = new Bookmark();
  b2.name = 'test 2';
  b2.url = 'https://www.test2.com';
  getAllBookmarkData().allBookmark.addBookmark(b1);
  getAllBookmarkData().allBookmark.addBookmark(b2);
  await saveCurrentAllBookmark();

  const allBookmark2 = await queryAllBookmark(tabSpaceId);
  expect(allBookmark2.toJSON()).toEqual(
    getAllBookmarkData().allBookmark.toJSON(),
  );
  allBookmark2.bookmarks.forEach((bookmark) => {
    const bIndex = getAllBookmarkData().allBookmark.bookmarks.findIndex(
      (b) => b.id === bookmark.id,
    );
    expect(bIndex).toBeGreaterThanOrEqual(0);
    const b = getAllBookmarkData().allBookmark.bookmarks.get(bIndex);
    expect(b.toJSON()).toEqual(bookmark.toJSON());
  });

  const changedUrl = b1.url + 'changed';
  getAllBookmarkData().allBookmark.updateBookmark(
    getAllBookmarkData().allBookmark.bookmarks.get(0).id,
    { url: changedUrl },
  );
  const changedName = (b2.name = 'changed');
  getAllBookmarkData().allBookmark.updateBookmark(
    getAllBookmarkData().allBookmark.bookmarks.get(1).id,
    { name: changedName },
  );
  await saveCurrentAllBookmark();
  const allBookmark3 = await queryAllBookmark(tabSpaceId);
  expect(allBookmark3.bookmarks.get(0).url).toEqual(changedUrl);
  expect(allBookmark3.bookmarks.get(1).name).toEqual(changedName);
});
