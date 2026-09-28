/**
 * Closed tabs (the History tool) are a synced entity: one record per closed
 * url, in the `SavedClosedTab` table. This pins both directions - a local write
 * reaches the outbox, and a record from another device lands in the table -
 * plus the one thing that makes this entity different from the others, namely
 * that rows are deleted as soon as they fall off the history cap.
 */
import {
  CLOSED_TAB_DB_TABLE_NAME,
  HISTORY_MAX_ENTRIES,
} from '../../closedTab/ClosedTab';
import { MemoryStorageArea, Outbox } from '../outbox';
import { SYNC_CONFIG_KEY } from '../syncConfig';
import { db } from '../../../storage/db';
import {
  applyServerRecords,
  entityForTable,
  listLocalRecords,
  tableForEntity,
} from '../dbBridge';
import { resetChangeFeedForTest, startChangeFeed } from '../changeFeed';
import { resetTestDb } from '../../../dev/dbImplTest';
import { SyncRecord } from '../types';

function entry(id: string, tabSpaceId: string, url: string, updatedAt: number) {
  return {
    id,
    tabSpaceId,
    title: `title of ${url}`,
    url,
    favIconUrl: `${url}/icon`,
    closedAt: updatedAt,
    timesClosed: 1,
    version: 10,
    createdAt: updatedAt,
    updatedAt,
  };
}

test('the closed tab table is the closedtab entity', () => {
  expect(entityForTable(CLOSED_TAB_DB_TABLE_NAME)).toBe('closedtab');
  expect(tableForEntity('closedtab')).toBe(CLOSED_TAB_DB_TABLE_NAME);
});

test('a locally closed tab is offered to the server', async () => {
  await resetTestDb();
  resetChangeFeedForTest();
  const storage = new MemoryStorageArea();
  await storage.set({
    [SYNC_CONFIG_KEY]: { baseUrl: 'http://x', token: 't', enabled: true },
  });
  const outbox = new Outbox(storage);
  await startChangeFeed({ storage, outbox, database: db as any });

  await db
    .table(CLOSED_TAB_DB_TABLE_NAME)
    .put(entry('c1', 'ts1', 'https://www.test1.com', 5000));
  await new Promise((resolve) => setTimeout(resolve, 50));

  const queued = await outbox.list();
  expect(queued.length).toBe(1);
  expect(queued[0].entity).toBe('closedtab');
  expect(queued[0].id).toBe('c1');
  expect(JSON.parse(queued[0].payload).url).toBe('https://www.test1.com');
});

test('a closed tab from another device lands in the table', async () => {
  await resetTestDb();
  const remote = entry('c9', 'ts1', 'https://www.test9.com', 7000);
  const record: SyncRecord = {
    entity: 'closedtab',
    id: 'c9',
    updated_at: 7000,
    deleted: false,
    rev: 3,
    server_at: 7001,
    payload: JSON.stringify(remote),
  };

  const result = await applyServerRecords([record]);
  expect(result.applied).toBe(1);
  const stored = await db.table(CLOSED_TAB_DB_TABLE_NAME).get('c9');
  expect(stored.url).toBe('https://www.test9.com');
  expect(stored.tabSpaceId).toBe('ts1');
});

test('a history row dropped by the cap is tombstoned on the server', async () => {
  await resetTestDb();
  // one row too many: the client prunes it, the server must forget it too
  const rows = Array.from({ length: HISTORY_MAX_ENTRIES + 1 }, (_v, i) =>
    entry(`c${i}`, 'ts1', `https://www.test${i}.com`, 1000 + i),
  );
  await db.table(CLOSED_TAB_DB_TABLE_NAME).bulkPut(rows);

  const doomed = rows[0];
  resetChangeFeedForTest();
  const storage = new MemoryStorageArea();
  await storage.set({
    [SYNC_CONFIG_KEY]: { baseUrl: 'http://x', token: 't', enabled: true },
  });
  const outbox = new Outbox(storage);
  await startChangeFeed({ storage, outbox, database: db as any });
  // what the store-driven save does: delete the rows it no longer holds
  await db.table(CLOSED_TAB_DB_TABLE_NAME).delete(doomed.id);
  await new Promise((resolve) => setTimeout(resolve, 50));

  const queued = await outbox.list();
  expect(queued.length).toBe(1);
  expect(queued[0].id).toBe(doomed.id);
  expect(queued[0].deleted).toBe(true);
  expect(queued[0].payload).toBe('');

  // what is still on offer is exactly the capped set
  const offered = await listLocalRecords(['closedtab']);
  expect(offered.length).toBe(HISTORY_MAX_ENTRIES);
});
