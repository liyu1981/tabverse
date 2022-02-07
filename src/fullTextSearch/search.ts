// borrowed and adapted from https://gist.github.com/inexorabletash/a279f03ab5610817c0540c83857e4295

import {
  FullTextIndexOwnerId,
  FullTextIndexRecordId,
  IFullTextSearchOption,
  IFullTextSearchState,
  PAGE_LIMIT_DEFAULT,
  STORE_NAME,
  TERM_INDEX_NAME,
  indexedDBRequestPromise,
} from './common';

import { getContext } from './context';

function searchImpl(
  index: IDBIndex,
  queryTerms: string[],
  option: IFullTextSearchOption,
  callback: (results: FullTextIndexRecordId[]) => void,
) {
  const resultSkipped = 0;
  const results = [];

  const pageStart = option.pageStart ?? 0;
  const pageLimit = option.pageLimit ?? PAGE_LIMIT_DEFAULT;

  if (queryTerms.length === 0) {
    throw new Error('empty query');
  }

  // Open a cursor for each term.
  let expect = 0;
  const requests = queryTerms.map((term) => index.openKeyCursor(term));
  requests.forEach((request) => {
    ++expect;
    request.onsuccess = () => {
      if (--expect === 0) {
        barrier();
      }
    };
  });

  function barrier() {
    const cursors = requests.map((r) => r.result);

    // If any cursor has reached end-of-range, we're done.
    if (cursors.includes(null)) {
      callback(results);
      return;
    }

    // Order cursors lowest/highest by primary key.
    cursors.sort((a, b) => indexedDB.cmp(a.primaryKey, b.primaryKey));

    // All equal? (lowest == highest)
    if (
      indexedDB.cmp(
        cursors[0].primaryKey,
        cursors[cursors.length - 1].primaryKey,
      ) === 0
    ) {
      // TODO: naive paging by skipping the records before pageStart, this could
      // cause the later page requested, the longer time we will need to query.
      // A better algorithm could be
      // https://www.codeproject.com/Articles/744986/How-to-do-some-magic-with-indexedDB
      if (resultSkipped >= pageStart) {
        results.push(cursors[0].primaryKey);
        if (results.length > pageLimit) {
          callback(results);
          return;
        }
      }
      expect = cursors.length;
      cursors.forEach((cursor) => cursor.continue());
    } else {
      // No - advance lowest cursor.
      expect = 1;
      cursors[0].continue();
    }
  }
}

async function loadOwnerIdsFromPrimaryKeys(
  primaryKeys: FullTextIndexRecordId[],
): Promise<FullTextIndexOwnerId[]> {
  const state = getContext();
  if (state === null) {
    return [];
  }

  const { db } = state;
  const tx = db.transaction([STORE_NAME]);
  const store = tx.objectStore(STORE_NAME);
  const records = await Promise.all(
    primaryKeys.map((pk) =>
      indexedDBRequestPromise<{ owner: string }>(store.get(pk)),
    ),
  );
  tx.commit();
  return records.map((record) => record.owner);
}

async function searchImplPromise(
  index: IDBIndex,
  queryTerms: string[],
  forOwnerId: boolean,
  option: IFullTextSearchOption = {},
): Promise<FullTextIndexRecordId[] | FullTextIndexOwnerId[]> {
  const pkResults = await new Promise<FullTextIndexRecordId[]>(
    (resolve, reject) => {
      searchImpl(index, queryTerms, option, (results) => resolve(results));
    },
  );
  if (forOwnerId) {
    const ownerIds = await loadOwnerIdsFromPrimaryKeys(pkResults);
    return Array.from(new Set(ownerIds));
  } else {
    return pkResults;
  }
}

export async function search(
  state: IFullTextSearchState,
  queryTerms: string[],
  forOwnerId = false,
  option: IFullTextSearchOption = {},
): Promise<FullTextIndexRecordId[] | FullTextIndexOwnerId[]> {
  const tx = state.db.transaction([STORE_NAME]);
  const index = tx.objectStore(STORE_NAME).index(TERM_INDEX_NAME);
  const results = await searchImplPromise(
    index,
    queryTerms,
    forOwnerId,
    option,
  );
  return results;
}
