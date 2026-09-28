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

/**
 * Waits for a condition instead of guessing how many ticks the feed needs.
 *
 * The feed is event driven: the write hook fires, the transaction commits, the
 * committed row is re-read, the batch is flushed on a microtask and the outbox
 * write is a storage round trip. Counting microtasks raced that chain and the
 * test went flaky under load - a fixed number of ticks is not a synchronisation
 * primitive.
 */
async function waitFor(
  description: string,
  condition: () => Promise<boolean>,
  timeoutMs = 2000,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for: ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Waits until the outbox holds `count` entries. */
async function waitForEntries(count: number) {
  await waitFor(`outbox to hold ${count} entr(y/ies)`, async () => {
    return (await outbox.size()) === count;
  });
}

test('a create is queued with the whole row as payload', async () => {
  await database
    .table('SavedNote')
    .put({ id: 'n1', name: 'hello', updatedAt: 1234, createdAt: 1 });
  await waitForEntries(1);

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
  await waitForEntries(1);

  // the outbox keeps one entry per record, newest edit wins, so this replaces
  // the entry above in place
  await database
    .table('SavedNote')
    .put({ id: 'n1', name: 'renamed', updatedAt: 2 });
  // the payload has to be the committed row, so wait for the *new* value to be
  // the one that lands, not merely for an entry to exist
  await waitFor('the updated row to be queued', async () => {
    const entries = await outbox.list();
    return (
      entries.length === 1 && JSON.parse(entries[0].payload).name === 'renamed'
    );
  });

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
  await waitForEntries(3);

  const entries = await outbox.list();
  expect(entries).toHaveLength(3);
  expect(entries.map((e) => e.id).sort()).toEqual(['t1', 't2', 't3']);
  expect(entries.every((e) => e.entity === 'todo')).toBe(true);
});

test('a delete becomes a tombstone', async () => {
  await database
    .table('SavedNote')
    .put({ id: 'n1', name: 'bye', updatedAt: 1 });
  await waitForEntries(1);

  await database.table('SavedNote').delete('n1');
  await waitFor('the tombstone to be queued', async () => {
    const entries = await outbox.list();
    return entries.length === 1 && entries[0].deleted === true;
  });

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
  // give the feed the same chance it has everywhere else, then prove it queued
  // nothing: a fixed wait would only prove the test was slow
  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(await bareOutbox.size()).toBe(0);
});
