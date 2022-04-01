import { $allBookmark, bookmarkStoreApi } from '../store';
import {
  loadAllBookmarkByTabSpaceId,
  queryAllBookmark,
  saveCurrentAllBookmark,
} from '../util';
import { newEmptyBookmark, setName, setUrl } from '../Bookmark';

import { $tabSpace } from '../../tabSpace/store';
import { initTabSpaceData } from '../../tabSpace/__tests__/store.test';
import { omit } from 'lodash';

async function bootstrapAllBookmark() {
  await initTabSpaceData();
  const tabSpaceId = $tabSpace.getState().id;
  await loadAllBookmarkByTabSpaceId(tabSpaceId);
  return { tabSpaceId };
}

test('all', async () => {
  const { tabSpaceId } = await bootstrapAllBookmark();
  expect($allBookmark.getState().bookmarks.size).toEqual(0);
  expect($allBookmark.getState().tabSpaceId).toEqual(tabSpaceId);

  bookmarkStoreApi.addBookmark(
    setUrl('https://www.test1.com', setName('test 1', newEmptyBookmark())),
  );
  bookmarkStoreApi.addBookmark(
    setUrl('https://www.test2.com', setName('test 2', newEmptyBookmark())),
  );
  await saveCurrentAllBookmark();

  const allBookmark2 = await queryAllBookmark(tabSpaceId);
  expect(omit(allBookmark2, 'bookmarks')).toEqual(
    omit($allBookmark.getState(), 'bookmarks'),
  );
  allBookmark2.bookmarks.forEach((bookmark) => {
    const bIndex = $allBookmark
      .getState()
      .bookmarks.findIndex((b) => b.id === bookmark.id);
    expect(bIndex).toBeGreaterThanOrEqual(0);
    const b = $allBookmark.getState().bookmarks.get(bIndex);
    expect(b).toEqual(bookmark);
  });

  const b1 = $allBookmark.getState().bookmarks.get(0);
  const changedUrl = b1.url + 'changed';
  const b2 = $allBookmark.getState().bookmarks.get(1);
  const changedName = b2.name + 'changed';
  bookmarkStoreApi.updateBookmark({ bid: b1.id, changes: { url: changedUrl } });
  bookmarkStoreApi.updateBookmark({
    bid: b2.id,
    changes: { name: changedName },
  });
  await saveCurrentAllBookmark();

  const allBookmark3 = await queryAllBookmark(tabSpaceId);
  expect(allBookmark3.bookmarks.get(0).url).toEqual(changedUrl);
  expect(allBookmark3.bookmarks.get(1).name).toEqual(changedName);
});
