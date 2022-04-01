import { IBase, setAttrForObject2 } from '../common';
import { inPlaceConvertToSaved, newEmptyBase } from '../Base';

import { NotTabSpaceId } from '../chromeSession/ChromeSession';
import produce from 'immer';

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

export const setTabSpaceId = setAttrForObject2<string, Bookmark>('tabSpaceId');
export const setName = setAttrForObject2<string, Bookmark>('name');
export const setUrl = setAttrForObject2<string, Bookmark>('url');
export const setFavIconUrl = setAttrForObject2<string, Bookmark>('favIconUrl');

export function convertToSavedBookmark(targetBookmark: Bookmark): Bookmark {
  return produce(targetBookmark, (draft) => {
    inPlaceConvertToSaved(draft);
  });
}
