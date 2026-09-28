import { db } from '../../../storage/db';
import { resetTestDb } from '../../../dev/dbImplTest';
import {
  applyServerRecords,
  entityForTable,
  listLocalRecords,
  rowUpdatedAt,
} from '../dbBridge';
import { SyncRecord } from '../types';

const NOTE = 'SavedNote';
const ALLNOTE = 'SavedAllNote';
const TABSPACE = 'SavedTabSpace';
const TAB = 'SavedTab';

function note(id: string, tabSpaceId: string, updatedAt: number, name = id) {
  return {
    id,
    tabSpaceId,
    name,
    data: `body of ${name}`,
    version: 7,
    createdAt: 1000,
    updatedAt,
  };
}

beforeEach(async () => {
  await resetTestDb();
});

test('entityForTable knows every syncable table', () => {
  expect(entityForTable(NOTE)).toBe('note');
  expect(entityForTable(ALLNOTE)).toBe('allnote');
  expect(entityForTable(TABSPACE)).toBe('tabspace');
  expect(entityForTable(TAB)).toBe('tab');
  expect(entityForTable('SavedAllTodo')).toBe('alltodo');
  expect(entityForTable('nope')).toBeNull();
});

test('listLocalRecords reads saved rows and skips unsaved ones', async () => {
  await db.table(TABSPACE).put({
    id: 'ts1',
    name: 'space one',
    tabIds: ['t1'],
    windowId: 3,
    version: 7,
    createdAt: 1000,
    updatedAt: 2000,
  });
  await db.table(NOTE).bulkPut([
    note('n1', 'ts1', 3000),
    // an unsaved row (ids are prefixed with ~) must never be uploaded
    { ...note('~draft', 'ts1', 4000), id: '~draft' },
  ]);

  const records = await listLocalRecords();
  const byKey = new Map(records.map((r) => [`${r.entity}/${r.id}`, r]));

  expect(byKey.size).toBe(2);
  expect(byKey.get('tabspace/ts1')).toMatchObject({
    entity: 'tabspace',
    id: 'ts1',
    updated_at: 2000,
    deleted: false,
  });
  expect(byKey.get('note/n1')!.updated_at).toBe(3000);
  expect(byKey.get('note/~draft')).toBeUndefined();

  const parsed = JSON.parse(byKey.get('note/n1')!.payload);
  expect(parsed).toMatchObject({ id: 'n1', name: 'n1', tabSpaceId: 'ts1' });
});

test('listLocalRecords can be restricted to some entities', async () => {
  await db.table(NOTE).put(note('n1', 'ts1', 3000));
  await db.table(TABSPACE).put({
    id: 'ts1',
    name: 'space one',
    tabIds: [],
    windowId: 3,
    version: 7,
    createdAt: 1000,
    updatedAt: 2000,
  });

  const onlyNotes = await listLocalRecords(['note']);
  expect(onlyNotes).toHaveLength(1);
  expect(onlyNotes[0].entity).toBe('note');
});

test('round trip: list -> wipe -> apply restores rows and aggregate order', async () => {
  await db.table(TABSPACE).put({
    id: 'ts1',
    name: 'space one',
    tabIds: ['t1', 't2'],
    windowId: 3,
    version: 7,
    createdAt: 1000,
    updatedAt: 2000,
  });
  await db
    .table(NOTE)
    .bulkPut([note('n2', 'ts1', 3000), note('n1', 'ts1', 2500)]);
  // the aggregate carries the display order of the notes
  await db.table(ALLNOTE).put({
    id: 'an1',
    tabSpaceId: 'ts1',
    noteIds: ['n2', 'n1'],
    version: 7,
    createdAt: 1000,
    updatedAt: 3000,
  });

  const uploaded = await listLocalRecords();

  // simulate a fresh device
  await db.table(NOTE).clear();
  await db.table(ALLNOTE).clear();
  await db.table(TABSPACE).clear();

  const result = await applyServerRecords(
    uploaded.map((r) => ({ ...r, deleted: false, rev: 1, server_at: 1 })),
  );
  // ts1 + n1 + n2 + the allnote aggregate
  expect(result).toMatchObject({ applied: 4, deleted: 0, errors: 0 });

  const notes = await db.table(NOTE).toArray();
  expect(notes).toHaveLength(2);

  const allNote: any = await db.table(ALLNOTE).get('an1');
  expect(allNote.noteIds).toEqual(['n2', 'n1']); // order preserved

  const space: any = await db.table(TABSPACE).get('ts1');
  expect(space.tabIds).toEqual(['t1', 't2']);
  expect(space.name).toBe('space one');
});

test('apply deletes on tombstone', async () => {
  await db.table(NOTE).put(note('n1', 'ts1', 3000));
  const tombstone: SyncRecord = {
    entity: 'note',
    id: 'n1',
    updated_at: 5000,
    deleted: true,
    payload: '',
    rev: 2,
    server_at: 5000,
  };

  const result = await applyServerRecords([tombstone]);
  expect(result).toMatchObject({ deleted: 1, applied: 0 });
  expect(await db.table(NOTE).get('n1')).toBeUndefined();
});

test('apply keeps a row that is locally newer than the incoming record', async () => {
  await db.table(NOTE).put(note('n1', 'ts1', 9000, 'local newer'));

  const incoming: SyncRecord = {
    entity: 'note',
    id: 'n1',
    updated_at: 5000, // older than the local copy
    deleted: false,
    payload: JSON.stringify(note('n1', 'ts1', 5000, 'server older')),
    rev: 2,
    server_at: 5000,
  };

  const result = await applyServerRecords([incoming]);
  expect(result).toMatchObject({ skipped: 1, applied: 0 });

  const local: any = await db.table(NOTE).get('n1');
  expect(local.name).toBe('local newer');
  expect(local.updatedAt).toBe(9000);
});

test('apply overwrites when the server copy is newer', async () => {
  await db.table(NOTE).put(note('n1', 'ts1', 5000, 'local older'));

  const incoming: SyncRecord = {
    entity: 'note',
    id: 'n1',
    updated_at: 9000,
    deleted: false,
    payload: JSON.stringify(note('n1', 'ts1', 9000, 'server newer')),
    rev: 2,
    server_at: 9000,
  };

  const result = await applyServerRecords([incoming]);
  expect(result).toMatchObject({ applied: 1 });

  const local: any = await db.table(NOTE).get('n1');
  expect(local.name).toBe('server newer');
});

test('apply forces the record id and survives bad payloads', async () => {
  const evil: SyncRecord = {
    entity: 'note',
    id: 'target-id',
    updated_at: 9000,
    deleted: false,
    // a payload whose own id points somewhere else must not win
    payload: JSON.stringify(note('other-id', 'ts1', 9000)),
    rev: 1,
    server_at: 9000,
  };
  const broken: SyncRecord = {
    entity: 'note',
    id: 'broken',
    updated_at: 9000,
    deleted: false,
    payload: '{not json',
    rev: 1,
    server_at: 9000,
  };
  const unknownEntity: SyncRecord = {
    entity: 'evil' as any,
    id: 'x',
    updated_at: 1,
    deleted: false,
    payload: '{}',
    rev: 1,
    server_at: 1,
  };

  const result = await applyServerRecords([evil, broken, unknownEntity]);
  expect(result).toMatchObject({ applied: 1, errors: 2 });
  expect(await db.table(NOTE).get('target-id')).toBeDefined();
  expect(await db.table(NOTE).get('other-id')).toBeUndefined();
  expect(await db.table(NOTE).get('broken')).toBeUndefined();
});

test('rowUpdatedAt falls back to createdAt then to now', () => {
  expect(rowUpdatedAt({ updatedAt: 5, createdAt: 1 })).toBe(5);
  expect(rowUpdatedAt({ updatedAt: -1, createdAt: 42 })).toBe(42);
  expect(rowUpdatedAt({ updatedAt: -1, createdAt: -1 })).toBeGreaterThan(0);
});
