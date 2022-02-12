import { getDb, search } from '../../fullTextSearch';

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
  const db = getDb();
  const records = await search(db, {
    queryTerms: { andTerms: [{ terms }] },
    option: { pageStart, pageLimit },
  });
  const tabSpaces = await querySavedTabSpace({
    anyOf: uniq(records.map((record) => record.ultimateOwner)),
  });
  return tabSpaces;
}
