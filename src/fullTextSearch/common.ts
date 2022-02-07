import { TABSPACE_DB_VERSION } from '../global';

export interface IFullTextSearchState {
  id: string;
  db: IDBDatabase;
}

export interface IFullTextAddToIndexParam {
  owner: string;
  content: string;
  field: string;
  type: string;
}

export interface IFullTextRemoveFromIndexParam {
  owner: string;
}

export interface IFullTextSearchOption {
  pageStart?: number;
  pageLimit?: number;
}

export type FullTextIndexRecordId = string;
export type FullTextIndexOwnerId = string;

export const TABSPACE_FULLTEXT_DB_VERSION = TABSPACE_DB_VERSION * 10; // align with Dexie by *10
export const DB_NAME = 'TabSpaceFullText';
export const STORE_NAME = 'index';
export const OWNER_INDEX_NAME = 'owner_index';
export const TYPE_INDEX_NAME = 'type_index';
export const FIELD_INDEX_NAME = 'field_index';
export const TERM_INDEX_NAME = 'term_index';
export const PAGE_LIMIT_DEFAULT = 2;

export function indexedDBRequestPromise<T>(
  idbRequest: IDBRequest<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    idbRequest.onsuccess = () => {
      resolve(idbRequest.result);
    };
    idbRequest.onerror = () => {
      reject(idbRequest.error);
    };
  });
}
