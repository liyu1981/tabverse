// borrowed and adapted from https://gist.github.com/inexorabletash/a279f03ab5610817c0540c83857e4295

import { FullTextIndexRecordId } from './common';

function searchImpl(
  index: IDBIndex,
  queryTerms: string[],
  callback: (results: FullTextIndexRecordId[]) => void,
) {
  const results = [];

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
      results.push(cursors[0].primaryKey);
      expect = cursors.length;
      cursors.forEach((cursor) => cursor.continue());
    } else {
      // No - advance lowest cursor.
      expect = 1;
      cursors[0].continue();
    }
  }
}

export async function search(
  index: IDBIndex,
  queryTerms: string[],
): Promise<FullTextIndexRecordId[]> {
  return new Promise((resolve, reject) => {
    searchImpl(index, queryTerms, (results) => resolve(results));
  });
}
