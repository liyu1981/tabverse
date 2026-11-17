/**
 * The Launchpad's record through the sync layer: one new entity, one binding,
 * one outbox entry per write, a tombstone on delete, and a pulled row landing
 * in the table with its icon bytes intact.
 */
import { beforeEach, expect, test } from 'vitest';

import { MemoryStorageArea, Outbox } from '../outbox';
import { SYNC_CONFIG_KEY } from '../syncConfig';
import { entityForTable, tableForEntity } from '../dbBridge';
import { RecordInput, SyncRecord } from '../types';
import { applyServerRecords } from '../dbBridge';
import { db } from '../../../storage/db';
import { resetTestDb } from '../../../dev/dbImplTest';
import { resetChangeFeedForTest, startChangeFeed } from '../changeFeed';
import { SHORTCUT_DB_TABLE_NAME, Shortcut } from '../../shortcut/Shortcut';
import { deleteShortcut, saveShortcut } from '../../shortcut/util';

const ICON = 'data:image/png;base64,AAA';

class RecordingOutbox extends Outbox {
  batches: RecordInput[][] = [];

  override enqueueMany(inputs: RecordInput[]): Promise<any> {
    this.batches.push(inputs.map((input) => ({ ...input })));
    return super.enqueueMany(inputs);
  }

  queued(): RecordInput[] {
    return this.batches.flat();
  }

  reset(): void {
    this.batches = [];
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

function shortcut(overrides: Partial<Shortcut> = {}): Shortcut {
  return {
    id: 's1',
    name: 'Figma',
    url: 'https://www.figma.com/',
    iconDataUrl: ICON,
    iconUrl: 'https://www.figma.com/apple.png',
    favIconUrl: '',
    createdAt: 1,
    updatedAt: 2,
    version: 12,
    ...overrides,
  };
}

async function rows(): Promise<Shortcut[]> {
  return db.table<Shortcut>(SHORTCUT_DB_TABLE_NAME).toArray();
}

async function withFeed(): Promise<{
  storage: MemoryStorageArea;
  outbox: RecordingOutbox;
}> {
  const storage = new MemoryStorageArea();
  await storage.set({
    [SYNC_CONFIG_KEY]: {
      baseUrl: 'https://sync.example.com',
      token: 'tok',
      enabled: true,
    },
  });
  const outbox = new RecordingOutbox(storage);
  await startChangeFeed({ storage, outbox, database: db as any });
  return { storage, outbox };
}

beforeEach(async () => {
  await resetTestDb();
  resetChangeFeedForTest();
});

test('the entity and the table map to each other', () => {
  expect(tableForEntity('shortcut')).toBe(SHORTCUT_DB_TABLE_NAME);
  expect(entityForTable(SHORTCUT_DB_TABLE_NAME)).toBe('shortcut');
});

test('saving a shortcut queues one record with its bytes', async () => {
  const { outbox } = await withFeed();
  await saveShortcut(shortcut());
  await settle();

  const queued = outbox.queued().filter((row) => row.entity === 'shortcut');
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({
    entity: 'shortcut',
    id: 's1',
    deleted: false,
  });
  expect(JSON.parse(queued[0]?.payload ?? '{}').iconDataUrl).toBe(ICON);

  resetChangeFeedForTest();
});

test('deleting a shortcut queues a tombstone', async () => {
  const { outbox } = await withFeed();
  await db.table<Shortcut>(SHORTCUT_DB_TABLE_NAME).put(shortcut());
  await settle();
  outbox.reset();

  await deleteShortcut('s1');
  await settle();

  const queued = outbox.queued().filter((row) => row.entity === 'shortcut');
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({ id: 's1', deleted: true });
  expect(await rows()).toHaveLength(0);

  resetChangeFeedForTest();
});

test('a pulled shortcut lands in the table, bytes and all', async () => {
  await startChangeFeed({
    storage: new MemoryStorageArea(),
    outbox: new Outbox(new MemoryStorageArea()),
    database: db as any,
  });
  const record: SyncRecord = {
    entity: 'shortcut',
    id: 's2',
    updated_at: 5,
    deleted: false,
    payload: JSON.stringify(shortcut({ id: 's2', name: 'Linear' })),
    rev: 3,
    server_at: 5,
  };
  const result = await applyServerRecords([record]);
  expect(result.applied).toBe(1);

  const [row] = await rows();
  expect(row?.name).toBe('Linear');
  expect(row?.iconDataUrl).toBe(ICON);

  resetChangeFeedForTest();
});

test('a pulled tombstone removes the local row', async () => {
  await db.table<Shortcut>(SHORTCUT_DB_TABLE_NAME).put(shortcut());
  await applyServerRecords([
    {
      entity: 'shortcut',
      id: 's1',
      updated_at: 10,
      deleted: true,
      payload: '',
      rev: 4,
      server_at: 10,
    },
  ]);
  expect(await rows()).toHaveLength(0);
});
