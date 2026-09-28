import {
  LocalWrite,
  WRITE_CREATE,
  WRITE_DELETE,
  WRITE_UPDATE,
  handleChanges,
  isRemoteApplyActive,
  resetChangeFeedForTest,
  runAsRemoteApply,
} from '../changeFeed';
import { MemoryStorageArea, Outbox } from '../outbox';
import { SYNC_CONFIG_KEY } from '../syncConfig';

function createChange(table: string, obj: any): LocalWrite {
  return { type: WRITE_CREATE, table, key: obj ? obj.id : undefined, obj };
}

function updateChange(table: string, obj: any): LocalWrite {
  return { type: WRITE_UPDATE, table, key: obj.id, obj };
}

function deleteChange(table: string, key: string): LocalWrite {
  return { type: WRITE_DELETE, table, key };
}

async function setup(enabled: boolean) {
  const storage = new MemoryStorageArea();
  if (enabled !== undefined) {
    await storage.set({
      [SYNC_CONFIG_KEY]: {
        baseUrl: 'https://sync.example.com',
        token: 'tok',
        enabled,
      },
    });
  }
  const outbox = new Outbox(storage);
  return { storage, outbox };
}

beforeEach(() => {
  resetChangeFeedForTest();
});

test('creates an outbox entry for a saved row', async () => {
  const { storage, outbox } = await setup(true);

  await handleChanges(
    [
      createChange('SavedNote', {
        id: 'n1',
        name: 'hi',
        updatedAt: 1234,
        createdAt: 1,
      }),
    ],
    outbox,
    storage,
  );

  const entries = await outbox.list();
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    entity: 'note',
    id: 'n1',
    updated_at: 1234,
    deleted: false,
  });
  expect(JSON.parse(entries[0].payload)).toMatchObject({
    id: 'n1',
    name: 'hi',
  });
});

test('turns a delete into a tombstone entry', async () => {
  const { storage, outbox } = await setup(true);

  await handleChanges([deleteChange('SavedTab', 't1')], outbox, storage);

  const entries = await outbox.list();
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    entity: 'tab',
    id: 't1',
    deleted: true,
    payload: '',
  });
  expect(entries[0].updated_at).toBeGreaterThan(0);
});

test('update changes are queued like creates', async () => {
  const { storage, outbox } = await setup(true);

  await handleChanges(
    [updateChange('SavedTodo', { id: 'x1', content: 'do', updatedAt: 55 })],
    outbox,
    storage,
  );

  expect(await outbox.size()).toBe(1);
});

test('tables outside the sync mapping are ignored', async () => {
  const { storage, outbox } = await setup(true);

  await handleChanges(
    [
      createChange('_changes', { rev: 1 }),
      createChange('_syncNodes', { id: 'node' }),
      createChange('SomethingElse', { id: 'z' }),
    ],
    outbox,
    storage,
  );

  expect(await outbox.size()).toBe(0);
});

test('nothing is queued when sync is not configured or disabled', async () => {
  const unconfigured = await setup(undefined as any);
  await handleChanges(
    [createChange('SavedNote', { id: 'n1', updatedAt: 1 })],
    unconfigured.outbox,
    unconfigured.storage,
  );
  expect(await unconfigured.outbox.size()).toBe(0);

  const disabled = await setup(false);
  await handleChanges(
    [createChange('SavedNote', { id: 'n1', updatedAt: 1 })],
    disabled.outbox,
    disabled.storage,
  );
  expect(await disabled.outbox.size()).toBe(0);
});

test('remote applies are suppressed (no pull -> push echo)', async () => {
  const { storage, outbox } = await setup(true);

  expect(isRemoteApplyActive()).toBe(false);
  await runAsRemoteApply(async () => {
    expect(isRemoteApplyActive()).toBe(true);
    await handleChanges(
      [createChange('SavedNote', { id: 'n1', updatedAt: 1 })],
      outbox,
      storage,
    );
  });
  expect(isRemoteApplyActive()).toBe(false);
  expect(await outbox.size()).toBe(0);

  // outside of a remote apply the very same change is queued
  await handleChanges(
    [createChange('SavedNote', { id: 'n1', updatedAt: 1 })],
    outbox,
    storage,
  );
  expect(await outbox.size()).toBe(1);
});

test('runAsRemoteApply resets the flag even when the callback throws', async () => {
  await expect(
    runAsRemoteApply(async () => {
      throw new Error('boom');
    }),
  ).rejects.toThrow('boom');
  expect(isRemoteApplyActive()).toBe(false);
});

test('changes without an id are skipped instead of throwing', async () => {
  const { storage, outbox } = await setup(true);

  await handleChanges(
    [
      createChange('SavedNote', { name: 'no id', updatedAt: 1 }),
      createChange('SavedNote', null),
      { type: WRITE_DELETE, table: 'SavedNote', key: 12345 as any },
    ],
    outbox,
    storage,
  );

  expect(await outbox.size()).toBe(0);
});
