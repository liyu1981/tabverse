/**
 * The chromesession object store is dropped by the v7 -> v8 schema bump, which
 * is a data-affecting change: this test builds a database the way an *older*
 * build would have left it (raw IndexedDB at Dexie version 7, sessions
 * included), opens it with the current TabSpaceDatabase and checks that the
 * store is gone while everything else survives.
 */
import fakeIndexedDB from 'fake-indexeddb';
import fakeIDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';

import Dexie from 'dexie';

import { TABSPACE_DB_VERSION, logger } from '../../global';
import { TabSpaceDatabase } from '../TabSpaceDatabase';
import { schemas } from '../schema';

// Dexie is pointed at the in-memory implementation, the same way
// src/dev/dbImplTest.ts does for the rest of the suite
Dexie.dependencies.indexedDB = fakeIndexedDB as any;
Dexie.dependencies.IDBKeyRange = fakeIDBKeyRange as any;

const TAG = 'upgrade-test';
const DB_NAME = `TabSpaceDB-${TAG}`;

// what v7 declared: the current stores plus the session snapshots
const V7_SCHEMAS: { [name: string]: string } = {
  ...schemas,
  ChromeSession: 'id, tag, createdAt, updatedAt',
};

/** Creates the database an older build would have created (Dexie v7 = IDB 70). */
function createV7Database(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDB.open(DB_NAME, 70);
    request.onupgradeneeded = () => {
      const idb = request.result;
      for (const [name, spec] of Object.entries(V7_SCHEMAS)) {
        if (!idb.objectStoreNames.contains(name)) {
          idb.createObjectStore(name, { keyPath: 'id' });
        }
        // indexes are not needed to prove the store is dropped; Dexie only
        // looks at objectStoreNames here
        void spec;
      }
    };
    request.onsuccess = () => {
      const idb = request.result;
      // leave one row behind in every store so we can prove data survives
      const tx = idb.transaction(Object.keys(V7_SCHEMAS), 'readwrite');
      for (const name of Object.keys(V7_SCHEMAS)) {
        tx.objectStore(name).put({ id: `row-${name}`, updatedAt: 1 });
      }
      tx.oncomplete = () => {
        idb.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * What v10 declared: the same stores, with the preview table before it learned
 * to record which browser run wrote a row (data/tabSpace/previewSession).
 */
const V10_SCHEMAS: { [name: string]: string } = {
  ...schemas,
  SavedTabPreview: 'id, capturedAt',
};

/** Creates the database a v10 build would have created (Dexie v10 = IDB 100). */
function createV10Database(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDB.open(DB_NAME + '-v10', 100);
    request.onupgradeneeded = () => {
      const idb = request.result;
      for (const [name, spec] of Object.entries(V10_SCHEMAS)) {
        if (!idb.objectStoreNames.contains(name)) {
          idb.createObjectStore(name, { keyPath: 'id' });
        }
        // only the store matters here; Dexie adds the missing sessionId index
        // on the version upgrade, which is what the test below checks
        void spec;
      }
    };
    request.onsuccess = () => {
      const idb = request.result;
      const tx = idb.transaction(
        ['SavedTabPreview', 'SavedTabSpace'],
        'readwrite',
      );
      tx.objectStore('SavedTabPreview').put({
        id: '1',
        capturedAt: 1,
        preview: 'data:image/jpeg;base64,AAA',
      });
      tx.objectStore('SavedTabSpace').put({ id: 'ts1', updatedAt: 1 });
      tx.oncomplete = () => {
        idb.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

describe(`schema v${TABSPACE_DB_VERSION}`, () => {
  test('no longer declares a session store', () => {
    expect(Object.keys(schemas)).not.toContain('ChromeSession');
  });

  test('opening a v7 database drops the session store and keeps the data', async () => {
    await createV7Database();

    const database = new TabSpaceDatabase(TAG);
    await database.open();

    expect(database.tables.map((t) => t.name).sort()).toEqual(
      Object.keys(schemas).sort(),
    );
    expect(Array.from(database.backendDB().objectStoreNames)).not.toContain(
      'ChromeSession',
    );

    // the other stores are still readable and their rows survived
    for (const name of Object.keys(schemas)) {
      const row = await database.table(name).get(`row-${name}`);
      expect(row, `row in ${name}`).toBeTruthy();
    }

    await database.delete();
  });

  // The preview table is a cache (data/tabSpace/previewReaper), so its schema
  // change is the one that must not cost a migration: rows written without a
  // session id are simply unowned, and the reaper drops them.
  test('opening a v10 database adds the preview session index and keeps the rows', async () => {
    await createV10Database();
    const database = new TabSpaceDatabase(TAG + '-v10');
    await database.open();

    // the row survives, with no session id: the reaper treats it as unowned
    const row = await database.table('SavedTabPreview').get('1');
    expect(row, 'the preview row did not survive the upgrade').toBeTruthy();
    expect(row.sessionId).toBeUndefined();

    // the index the reaper queries exists now
    expect(Array.from(database.backendDB().objectStoreNames)).toContain(
      'SavedTabPreview',
    );
    expect(
      (database.table('SavedTabPreview') as any).schema.primKey.keyPath,
    ).toBe('id');
    const indexNames = (
      database.table('SavedTabPreview') as any
    ).schema.indexes.map((i: any) => i.name);
    expect(indexNames).toContain('sessionId');

    // and nothing else moved
    await expect(
      database.table('SavedTabSpace').get('ts1'),
    ).resolves.toBeTruthy();

    await database.delete();
  });

  test('an older build can still open the database', async () => {
    await createV7Database();
    const current = new TabSpaceDatabase(TAG);
    await current.open();
    await current.close();

    // Worth knowing: dropping the store does NOT lock out older builds. Dexie
    // compares the declared v7 schema with the installed one, sees the missing
    // store, re-creates it and bumps the native version ("SchemaDiff: Schema
    // was extended..."). A rolled back build therefore keeps working and goes
    // back to recording session snapshots - which the server still accepts and
    // prunes, so nothing breaks in either direction.
    const older = new Dexie(DB_NAME);
    older.version(7).stores(V7_SCHEMAS);
    await older.open();

    expect(older.tables.map((t) => t.name)).toContain('ChromeSession');
    // and the other stores are still there
    await expect(
      older.table('SavedNote').get('row-SavedNote'),
    ).resolves.toBeTruthy();

    await older.delete();
  });
});

beforeAll(() => {
  setDebugLogLevelForTest();
});

function setDebugLogLevelForTest() {
  // the TabSpaceDatabase constructor logs the registered schemas at INFO
  logger.log = () => undefined;
}
