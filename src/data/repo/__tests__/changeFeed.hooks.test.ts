/**
 * The change feed is fed by Dexie write hooks, so this exercises the real
 * thing: a Dexie 4 database on fake-indexeddb, writes through it, and the
 * outbox. The payload assertions are the regression guard - a feed built from
 * the `updating` *diff* would silently truncate records.
 */
import Dexie from 'dexie';
import fakeIndexedDB from 'fake-indexeddb';
import fakeIDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';

import { MemoryStorageArea, Outbox } from '../outbox';
import { resetChangeFeedForTest, startChangeFeed } from '../changeFeed';
import { SYNC_CONFIG_KEY } from '../syncConfig';

Dexie.dependencies.indexedDB = fakeIndexedDB as any;
Dexie.dependencies.IDBKeyRange = fakeIDBKeyRange as any;

let dbCounter = 0;
let database: Dexie;
let storage: MemoryStorageArea;
let outbox: Outbox;

beforeEach(async () => {
  resetChangeFeedForTest();
  dbCounter += 1;
  database = new Dexie(`change-feed-hooks-${dbCounter}`);
  database.version(1).stores({
    SavedNote: 'id, updatedAt',
    SavedTodo: 'id, updatedAt',
  });
  await database.open();
  storage = new MemoryStorageArea();
  await storage.set({
    [SYNC_CONFIG_KEY]: {
      baseUrl: 'http://localhost:8223',
      token: 'tok',
      enabled: true,
    },
  });
  outbox = new Outbox(storage);
  await startChangeFeed({ storage, outbox, database: database as any });
});

/** let the microtask batch and the post-write re-reads settle */
async function settle() {
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('a create is queued with the whole row as payload', async () => {
  await database
    .table('SavedNote')
    .put({ id: 'n1', name: 'hello', updatedAt: 1234, createdAt: 1 });
  await settle();

  const entries = await outbox.list();
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    entity: 'note',
    id: 'n1',
    updated_at: 1234,
    deleted: false,
  });
  expect(JSON.parse(entries[0].payload)).toEqual({
    id: 'n1',
    name: 'hello',
    updatedAt: 1234,
    createdAt: 1,
  });
});

test('an update is queued with the committed row, not the diff', async () => {
  await database
    .table('SavedNote')
    .put({ id: 'n1', name: 'hello', tag: 'keep', updatedAt: 1 });
  await settle();

  // the outbox keeps one entry per record, newest edit wins, so the update
  // below replaces it in place
  await database
    .table('SavedNote')
    .put({ id: 'n1', name: 'renamed', updatedAt: 2 });
  await settle();

  const entries = await outbox.list();
  expect(entries).toHaveLength(1);
  const payload = JSON.parse(entries[0].payload);
  expect(payload.id).toBe('n1');
  expect(payload.name).toBe('renamed');
  expect(payload.updatedAt).toBe(2);
});

test('a bulk write collapses to one entry per record', async () => {
  await database.table('SavedTodo').bulkPut([
    { id: 't1', content: 'a', updatedAt: 1 },
    { id: 't2', content: 'b', updatedAt: 1 },
    { id: 't3', content: 'c', updatedAt: 1 },
  ]);
  await settle();

  const entries = await outbox.list();
  expect(entries).toHaveLength(3);
  expect(entries.map((e) => e.id).sort()).toEqual(['t1', 't2', 't3']);
  expect(entries.every((e) => e.entity === 'todo')).toBe(true);
});

test('a delete becomes a tombstone', async () => {
  await database
    .table('SavedNote')
    .put({ id: 'n1', name: 'bye', updatedAt: 1 });
  await settle();

  await database.table('SavedNote').delete('n1');
  await settle();

  const entries = await outbox.list();
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    entity: 'note',
    id: 'n1',
    deleted: true,
    payload: '',
  });
});

test('nothing is queued while sync is not configured', async () => {
  const bare = new MemoryStorageArea();
  const bareOutbox = new Outbox(bare);
  resetChangeFeedForTest();
  await startChangeFeed({
    storage: bare,
    outbox: bareOutbox,
    database: database as any,
  });

  await database.table('SavedNote').put({ id: 'n9', updatedAt: 1 });
  await settle();

  expect(await bareOutbox.size()).toBe(0);
});
