import { convertToSavedBase, newEmptyBase } from '../Base';
import { NotTabSpaceId } from '../chromeSession/ChromeSession';
import { IBase } from '../common';

export interface Bookmark extends IBase {
  tabSpaceId: string;
  name: string;
  url: string;
  favIconUrl: string;
}

export type BookmarkLocalStorage = Pick<
  Bookmark,
  'name' | 'url' | 'favIconUrl'
>;

export const BOOKMARK_DB_TABLE_NAME = 'SavedBookmark';
export const BOOKMARK_DB_SCHEMA = 'id, createdAt, tabSpaceId, name, url';

export function newEmptyBookmark(): Bookmark {
  return {
    ...newEmptyBase(),
    tabSpaceId: NotTabSpaceId,
    name: '',
    url: '',
    favIconUrl: '',
  };
}

export function setTabSpaceId(
  tabSpaceId: string,
  targetBookmark: Bookmark,
): Bookmark {
  return { ...targetBookmark, tabSpaceId };
}

export function setName(name: string, targetBookmark: Bookmark): Bookmark {
  return { ...targetBookmark, name };
}

export function setUrl(url: string, targetBookmark: Bookmark): Bookmark {
  return { ...targetBookmark, url };
}

export function setFavIconUrl(
  favIconUrl: string,
  targetBookmark: Bookmark,
): Bookmark {
  return { ...targetBookmark, favIconUrl };
}

export function convertToSavedBookmark(targetBookmark: Bookmark): Bookmark {
  return {
    ...targetBookmark,
    ...convertToSavedBase(targetBookmark),
  };
}
