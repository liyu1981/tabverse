import {
  DB_NAME,
  FIELD_INDEX_NAME,
  IFullTextSearchState,
  OWNER_INDEX_NAME,
  STORE_NAME,
  TABSPACE_FULLTEXT_DB_VERSION,
  TERM_INDEX_NAME,
  TYPE_INDEX_NAME,
} from './common';

import { getNewId } from '../data/common';
import { logger } from '../global';

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
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error);
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

export function getContext(): IFullTextSearchState | null {
  return _state;
}
