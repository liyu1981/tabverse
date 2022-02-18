import { getDb, search } from '../../fullTextSearch';
import { perfEnd, perfStart } from '../../global';

import { Query } from '../../fullTextSearch';
import { querySavedTabSpace } from '../../data/tabSpace/SavedTabSpaceStore';
import { uniq } from 'lodash';

export interface ISearchSavedTabSpaceParams {
  query: Query;
  pageStart: number;
  pageLimit: number;
}

export async function searchSavedTabSpace({
  query,
  pageStart,
  pageLimit,
}: ISearchSavedTabSpaceParams) {
  const db = getDb();
  const { results, cursor } = await search(db, {
    query,
    option: { pageStart, pageLimit },
  });
  const tabSpaces = await querySavedTabSpace({
    anyOf: uniq(results.map((record) => record.ultimateOwner)),
  });
  return tabSpaces;
}
