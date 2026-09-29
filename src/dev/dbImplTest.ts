import Dexie from 'dexie';
import fakeIndexedDB from 'fake-indexeddb';
import fakeIDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';

import { getNewId } from '../data/common';
import { TabSpaceDatabase } from '../storage/TabSpaceDatabase';

// Point Dexie at the in-memory IndexedDB before the database is constructed.
Dexie.dependencies.indexedDB = fakeIndexedDB as any;
Dexie.dependencies.IDBKeyRange = fakeIDBKeyRange as any;

export const dbImpl: TabSpaceDatabase = new TabSpaceDatabase(getNewId());

export async function resetTestDb() {
  await dbImpl.delete();
  await dbImpl.open();
}
