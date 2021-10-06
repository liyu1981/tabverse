import { AllBookmark, Bookmark, IBookmarkJSON } from './bookmark';
import {
  SavedBookmarkStore,
  monitorAllBookmarkChange,
  monitorTabSpaceChanges,
  queryAllBookmark,
} from './bookmarkStore';

import { addPagingToQueryParams } from '../../store/store';
import { strict as assert } from 'assert';
import { exposeDebugData } from '../../debug';
import { getSavedStoreManager } from '../../store/bootstrap';

export interface AllBookmarkData {
  allBookmark: Readonly<AllBookmark>;
  savedBookmarkStore: Readonly<SavedBookmarkStore>;
}

let allBookmarkData: AllBookmarkData | null = null;

export function getAllBookmarkData(): AllBookmarkData {
  assert(allBookmarkData !== null, 'call bootstrap to init allBookmark!');
  return allBookmarkData;
}

export async function bootstrap(tabSpaceId: string) {
  const allBookmark = await queryAllBookmark(
    tabSpaceId,
    addPagingToQueryParams({}),
  );
  const savedBookmarkStore = new SavedBookmarkStore();
  const latestSavedTime =
    allBookmark.bookmarks.max((ba: Bookmark, bb: Bookmark) =>
      ba.updatedAt > bb.updatedAt ? 1 : ba.updatedAt === bb.updatedAt ? 0 : -1,
    )?.updatedAt ?? 0;
  savedBookmarkStore.updateLastSavedTime(latestSavedTime);
  getSavedStoreManager().addSavedStore('bookmark', savedBookmarkStore);
  allBookmarkData = {
    allBookmark,
    savedBookmarkStore,
  };

  monitorTabSpaceChanges(allBookmark);
  monitorAllBookmarkChange(allBookmark, savedBookmarkStore);
  exposeDebugData('bookmark', { getAllBookmarkData });
}
