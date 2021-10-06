import Dexie from 'dexie';
import { getNewId } from '../data/common';

Dexie.dependencies.indexedDB = require('fake-indexeddb');
Dexie.dependencies.IDBKeyRange = require('fake-indexeddb/lib/FDBKeyRange');

// console.log('will use dbImplTest');

const { TabSpaceDatabase } = require('../store/TabSpaceDatabase');
export const dbImpl = new TabSpaceDatabase(getNewId());

export async function resetTestDb() {
  await dbImpl.delete();
  await dbImpl.open();
}
