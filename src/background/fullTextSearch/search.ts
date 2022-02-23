import { getDb, IFullTextSearchCursor, search } from '../../fullTextSearch';

import { Query } from '../../fullTextSearch';
import { querySavedTabSpace } from '../../data/tabSpace/SavedTabSpaceStore';
import { uniq } from 'lodash';
import { TabSpace } from '../../data/tabSpace/TabSpace';

export interface ISearchSavedTabSpaceParams {
  query: Query;
  cursor: IFullTextSearchCursor;
}

export async function searchSavedTabSpace({
  query,
  cursor,
}: ISearchSavedTabSpaceParams): Promise<[TabSpace[], IFullTextSearchCursor]> {
  const db = getDb();
  const { results, nextCursor } = await search(db, {
    query,
    cursor,
  });
  const tabSpaces = await querySavedTabSpace({
    anyOf: uniq(results.map((record) => record.ultimateOwner)),
  });
  return [tabSpaces, nextCursor];
}
