import {
  DB_NAME,
  FIELD_INDEX_NAME,
  FullTextIndexRecordId,
  IFullTextAddToIndexParam,
  IFullTextRemoveFromIndexParam,
  IFullTextSearchState,
  OWNER_INDEX_NAME,
  STORE_NAME,
  TABSPACE_FULLTEXT_DB_VERSION,
  TERM_INDEX_NAME,
  TYPE_INDEX_NAME,
  indexedDBRequestPromise,
} from './common';
import { FullTextSearchMsg, sendChromeMessage } from '../message';

import { flatten } from 'lodash';
import { getNewId } from '../data/common';
import { getTabSpaceData } from '../data/tabSpace/bootstrap';
import { getWindow } from '../store/localSetting';
import { isDebug } from '../debug';
import { logger } from '../global';
import { search as searchImpl } from './search';
import { tokenize } from './tokenize';

function getDbUpgradeHandler(request: IDBRequest) {
  return (e: IDBVersionChangeEvent) => {
    if (e.oldVersion < TABSPACE_FULLTEXT_DB_VERSION) {
      const db = request.result;
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      store.createIndex(OWNER_INDEX_NAME, 'owner');
      store.createIndex(TERM_INDEX_NAME, 'terms', { multiEntry: true });
      store.createIndex(TYPE_INDEX_NAME, 'type');
      store.createIndex(FIELD_INDEX_NAME, 'field');
    }
  };
}

async function newSearchContext(): Promise<IFullTextSearchState> {
  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, TABSPACE_FULLTEXT_DB_VERSION);
    request.onupgradeneeded = getDbUpgradeHandler(request);
    request.onsuccess = (e) => {
      resolve(request.result);
    };
  });
  return {
    id: getNewId(),
    db,
  };
}

let _state = null;

export async function bootstrap() {
  _state = await newSearchContext();
  logger.log('bootstrap full text search, done.');
}

export function getContext() {
  return _state;
}

export async function addToIndex(
  state: IFullTextSearchState,
  param: IFullTextAddToIndexParam,
) {
  const { terms, lang } = await tokenize(param.content);
  const tx = state.db.transaction([STORE_NAME], 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const indexEntry = {
    id: getNewId(),
    owner: param.owner,
    type: param.type,
    field: param.field,
    terms: terms,
  };
  logger.log('addToIndex will store:', indexEntry);
  await indexedDBRequestPromise(store.put(indexEntry));
  tx.commit();
}

export async function removeFromIndex(
  state: IFullTextSearchState,
  param: IFullTextRemoveFromIndexParam,
) {
  const { owner } = param;
  const tx = state.db.transaction([STORE_NAME], 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const index = store.index(OWNER_INDEX_NAME);
  const allKeys = await indexedDBRequestPromise<IDBValidKey[]>(
    index.getAllKeys(owner),
  );
  await Promise.all(
    allKeys.map((key) => indexedDBRequestPromise(store.delete(key))),
  );
  tx.commit();
}

export async function search(
  state: IFullTextSearchState,
  queryTerms: string[],
): Promise<FullTextIndexRecordId[]> {
  const tx = state.db.transaction([STORE_NAME]);
  const index = tx.objectStore(STORE_NAME).index(TERM_INDEX_NAME);
  const results = await searchImpl(index, queryTerms);
  return results;
}

if (isDebug() && getWindow()) {
  // @ts-ignore
  getWindow().fulltext = {
    getContext,
    addToIndex,
    search,

    triggerAddToIndex: (id: string, type: string) => {
      sendChromeMessage({
        type: FullTextSearchMsg.AddToIndex,
        payload: { type, id },
      });
    },

    triggerReindexAllSavedTabSpaces: async () => {
      const allTabIds = flatten(
        getTabSpaceData().savedTabSpaceCollection.savedTabSpaces.map(
          (savedTabSpace) => {
            return savedTabSpace.tabs.map((tab) => tab.id).toArray();
          },
        ),
      );
      console.log('allTabIds are:', allTabIds);
      allTabIds.forEach((tabId) => {
        sendChromeMessage({
          type: FullTextSearchMsg.AddToIndex,
          payload: { type: 'tab', id: tabId },
        });
      });
    },
  };
}
