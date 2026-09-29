import { MemoryStorageArea, Outbox } from '../outbox';
import { RecordResult } from '../types';

function input(entity: any, id: string, updated_at: number, payload = '{}') {
  return { entity, id, updated_at, deleted: false, payload };
}

test('enqueue queues a fresh record', async () => {
  const outbox = new Outbox(new MemoryStorageArea());
  const outcome = await outbox.enqueue(input('note', 'n1', 100));
  expect(outcome).toBe('queued');
  expect(await outbox.size()).toBe(1);
  const entries = await outbox.list();
  expect(entries[0]).toMatchObject({
    entity: 'note',
    id: 'n1',
    updated_at: 100,
    attempts: 0,
  });
});

test('newer edit replaces the pending one, older edit is ignored', async () => {
  const outbox = new Outbox(new MemoryStorageArea());
  await outbox.enqueue(input('note', 'n1', 100, '{"v":1}'));

  expect(await outbox.enqueue(input('note', 'n1', 200, '{"v":2}'))).toBe(
    'replaced',
  );
  expect(await outbox.enqueue(input('note', 'n1', 150, '{"v":1.5}'))).toBe(
    'ignored_stale',
  );

  const entries = await outbox.list();
  expect(entries).toHaveLength(1);
  expect(entries[0].updated_at).toBe(200);
  expect(entries[0].payload).toBe('{"v":2}');
});

test('concurrent enqueues of different records all survive', async () => {
  const outbox = new Outbox(new MemoryStorageArea());
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      outbox.enqueue(input('tab', `t${i}`, 100 + i)),
    ),
  );
  expect(await outbox.size()).toBe(20);
});

test('concurrent enqueues of the same record keep the newest', async () => {
  const outbox = new Outbox(new MemoryStorageArea());
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      outbox.enqueue(input('note', 'same', (i + 1) * 100, `{"v":${i}}`)),
    ),
  );
  const entries = await outbox.list();
  expect(entries).toHaveLength(1);
  expect(entries[0].updated_at).toBe(1000);
});

test('applyResults drops acknowledged entries but keeps newer ones', async () => {
  const outbox = new Outbox(new MemoryStorageArea());
  await outbox.enqueue(input('note', 'n1', 100));
  await outbox.enqueue(input('todo', 'x1', 300));

  const results: RecordResult[] = [
    // n1 acked at 100; x1 not part of this flush at all
    { entity: 'note', id: 'n1', status: 'ok', rev: 1, updated_at: 100 },
  ];
  await outbox.applyResults(results);

  const entries = await outbox.list();
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ entity: 'todo', id: 'x1' });
});

test('applyResults keeps an entry edited during the flush', async () => {
  const outbox = new Outbox(new MemoryStorageArea());
  await outbox.enqueue(input('note', 'n1', 100));

  // the flush acknowledges the copy at 100 while the user already saved 200
  await outbox.enqueue(input('note', 'n1', 200));
  await outbox.applyResults([
    { entity: 'note', id: 'n1', status: 'ok', rev: 1, updated_at: 100 },
  ]);

  const entries = await outbox.list();
  expect(entries).toHaveLength(1);
  expect(entries[0].updated_at).toBe(200);
});

test('stale results also clear the losing entry', async () => {
  const outbox = new Outbox(new MemoryStorageArea());
  await outbox.enqueue(input('note', 'n1', 100));
  await outbox.applyResults([
    { entity: 'note', id: 'n1', status: 'stale', rev: 9, updated_at: 100 },
  ]);
  expect(await outbox.size()).toBe(0);
});

test('clear removes only the targeted record', async () => {
  const outbox = new Outbox(new MemoryStorageArea());
  await outbox.enqueue(input('note', 'n1', 100));
  await outbox.enqueue(input('note', 'n2', 100));
  await outbox.clear('note', 'n1');
  const entries = await outbox.list();
  expect(entries).toHaveLength(1);
  expect(entries[0].id).toBe('n2');
});

test('recordFailure counts attempts and keeps the error', async () => {
  const outbox = new Outbox(new MemoryStorageArea());
  await outbox.enqueue(input('note', 'n1', 100));
  await outbox.recordFailure('note', 'n1', 'boom');
  await outbox.recordFailure('note', 'n1', 'boom again');
  const entries = await outbox.list();
  expect(entries[0].attempts).toBe(2);
  expect(entries[0].last_error).toBe('boom again');
});

test('corrupted storage content is ignored instead of throwing', async () => {
  const storage = new MemoryStorageArea();
  await storage.set({ tabverse_outbox_v1: 'not-an-array' });
  const outbox = new Outbox(storage);
  expect(await outbox.list()).toEqual([]);

  await storage.set({ tabverse_outbox_v1: [{ bogus: true }, null] });
  expect(await outbox.list()).toEqual([]);
});
