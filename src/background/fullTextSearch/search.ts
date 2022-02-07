import { ISavedTab, Tab } from '../../data/tabSpace/Tab';
import { getContext, search } from '../../fullTextSearch';

import { db } from '../../store/db';
import { querySavedTabSpace } from '../../data/tabSpace/SavedTabSpaceStore';
import { uniq } from 'lodash';

export interface ISearchSavedTabSpaceParams {
  terms: string[];
  pageStart: number;
  pageLimit: number;
}

export async function searchSavedTabSpace({
  terms,
  pageStart,
  pageLimit,
}: ISearchSavedTabSpaceParams) {
  const ctx = getContext();
  const ownerIds = await search(ctx, terms, true, { pageStart, pageLimit });
  const savedTabs = await db
    .table<ISavedTab>(Tab.DB_TABLE_NAME)
    .where('id')
    .anyOf(ownerIds)
    .toArray();
  const tabSpaces = await querySavedTabSpace({
    anyOf: uniq(savedTabs.map((savedTab) => savedTab.tabSpaceId)),
  });
  return tabSpaces;
}
