import { AllBookmark, Bookmark, IBookmarkJSON } from './Bookmark';
import {
  SavedBookmarkStore,
  loadCurrentAllBookmarkFromLocalStorage,
  monitorAllBookmarkChange,
  monitorTabSpaceChanges,
  queryAllBookmark,
} from './SavedBookmarkStore';
import { exposeDebugData, isJestTest } from '../../debug';

import { NotTabSpaceId } from '../chromeSession/ChromeSession';
import { addPagingToQueryParams } from '../../store/store';
import { strict as assert } from 'assert';
import { getSavedStoreManager } from '../../store/bootstrap';
import { isIdNotSaved } from '../common';

export interface AllBookmarkData {
  allBookmark: Readonly<AllBookmark>;
  savedBookmarkStore: Readonly<SavedBookmarkStore>;
}

let allBookmarkData: AllBookmarkData | null = null;

export function getAllBookmarkData(): AllBookmarkData {
  assert(allBookmarkData !== null, 'call bootstrap to init allBookmark!');
  return allBookmarkData;
}

export function bootstrap() {
  allBookmarkData = {
    allBookmark: new AllBookmark(NotTabSpaceId),
    savedBookmarkStore: new SavedBookmarkStore(),
  };
  getSavedStoreManager().addSavedStore(
    'bookmark',
    allBookmarkData.savedBookmarkStore,
  );

  exposeDebugData('bookmark', { getAllBookmarkData });
}

export async function loadByTabSpaceId(tabSpaceId: string) {
  const { allBookmark, savedBookmarkStore } = getAllBookmarkData();
  if (isIdNotSaved(tabSpaceId) && !isJestTest()) {
    await loadCurrentAllBookmarkFromLocalStorage(allBookmark);
  } else {
    const loadedAllBookmark = await queryAllBookmark(
      tabSpaceId,
      addPagingToQueryParams({}),
    );
    allBookmark.copy(loadedAllBookmark);
  }

  const latestSavedTime =
    allBookmark.bookmarks.max((ba: Bookmark, bb: Bookmark) =>
      ba.updatedAt > bb.updatedAt ? 1 : ba.updatedAt === bb.updatedAt ? 0 : -1,
    )?.updatedAt ?? 0;
  savedBookmarkStore.updateLastSavedTime(latestSavedTime);

  monitorTabSpaceChanges(allBookmark);
  monitorAllBookmarkChange(allBookmark, savedBookmarkStore);
}
