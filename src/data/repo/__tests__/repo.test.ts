import { MemoryStorageArea, Outbox } from '../outbox';
import { MemorySyncStateStore, SyncEngine } from '../repo';
import { ServerApiError } from '../serverApi';
import { PullResult, PushResult, RecordInput, SyncRecord } from '../types';

class FakeApi {
  pushed: RecordInput[][] = [];
  pullCalls: number[] = [];
  pages: PullResult[] = [];
  pushResult: PushResult | null = null;
  error: Error | null = null;

  async push(records: RecordInput[]): Promise<PushResult> {
    if (this.error) {
      throw this.error;
    }
    this.pushed.push(records);
    if (this.pushResult) {
      return this.pushResult;
    }
    return {
      results: records.map((r) => ({
        entity: r.entity,
        id: r.id,
        status: 'ok' as const,
        rev: 1,
        updated_at: r.updated_at,
      })),
      server_rev: 1,
    };
  }

  async pull(since: number): Promise<PullResult> {
    if (this.error) {
      throw this.error;
    }
    this.pullCalls.push(since);
    if (this.pages.length > 0) {
      return this.pages.shift()!;
    }
    return { records: [], next_rev: since, has_more: false, server_rev: 1 };
  }
}

function record(id: string, rev: number): SyncRecord {
  return {
    entity: 'note',
    id,
    updated_at: 1000 + rev,
    deleted: false,
    payload: '{"text":"server state"}',
    rev,
    server_at: 1000 + rev,
  };
}

function setup(hooks: any = {}) {
  const api = new FakeApi();
  const outbox = new Outbox(new MemoryStorageArea());
  const stateStore = new MemorySyncStateStore();
  const engine = new SyncEngine(api as any, outbox, stateStore, hooks);
  return { api, outbox, stateStore, engine };
}

test('syncOnce flushes the outbox then pulls the delta', async () => {
  const { api, outbox, stateStore, engine } = setup();
  await outbox.enqueue({
    entity: 'note',
    id: 'local-1',
    updated_at: 500,
    deleted: false,
    payload: '{"text":"local"}',
  });
  api.pages = [
    {
      records: [record('s1', 1), record('s2', 2)],
      next_rev: 2,
      has_more: false,
      server_rev: 2,
    },
  ];

  const outcome = await engine.syncOnce();

  expect(outcome.status).toBe('ok');
  expect(outcome.pushed).toBe(1);
  expect(outcome.pulled).toBe(2);
  expect(outcome.cursor).toBe(2);

  // push happened before pull
  expect(api.pushed).toHaveLength(1);
  expect(api.pushed[0][0].id).toBe('local-1');
  expect(api.pullCalls).toEqual([0]);

  // outbox flushed, cursor persisted
  expect(await outbox.size()).toBe(0);
  expect((await stateStore.get()).last_rev).toBe(2);
});

test('pull is paginated until has_more is false', async () => {
  const { api, engine } = setup();
  api.pages = [
    {
      records: [record('a', 1)],
      next_rev: 1,
      has_more: true,
      server_rev: 3,
    },
    {
      records: [record('b', 2), record('c', 3)],
      next_rev: 3,
      has_more: true,
      server_rev: 3,
    },
    {
      records: [],
      next_rev: 3,
      has_more: false,
      server_rev: 3,
    },
  ];

  const outcome = await engine.syncOnce();

  expect(outcome.pulled).toBe(3);
  // each page resumes exactly where the previous one ended
  expect(api.pullCalls).toEqual([0, 1, 3]);
  expect(outcome.cursor).toBe(3);
});

test('onRecords receives server records', async () => {
  const seen: SyncRecord[][] = [];
  const { api, engine } = setup({
    onRecords: (records: SyncRecord[]) => {
      seen.push(records);
    },
  });
  api.pages = [
    {
      records: [record('x', 1)],
      next_rev: 1,
      has_more: false,
      server_rev: 1,
    },
  ];
  await engine.syncOnce();
  expect(seen).toHaveLength(1);
  expect(seen[0][0].id).toBe('x');
});

test('stale push triggers onConflict with local and server copy', async () => {
  const conflicts: Array<{ local: any; current: SyncRecord }> = [];
  const { api, outbox, engine } = setup({
    onConflict: (local: any, current: SyncRecord) => {
      conflicts.push({ local, current });
    },
  });
  await outbox.enqueue({
    entity: 'note',
    id: 'n1',
    updated_at: 100,
    deleted: false,
    payload: '{"text":"mine"}',
  });
  const winner = record('n1', 9);
  api.pushResult = {
    results: [
      {
        entity: 'note',
        id: 'n1',
        status: 'stale',
        rev: 9,
        updated_at: winner.updated_at,
        current: winner,
      },
    ],
    server_rev: 9,
  };

  const outcome = await engine.syncOnce();

  expect(outcome.status).toBe('ok');
  expect(outcome.stale).toBe(1);
  expect(outcome.pushed).toBe(0);
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0].local.payload).toBe('{"text":"mine"}');
  expect(conflicts[0].current.rev).toBe(9);
  // the losing entry is gone, otherwise it would be retried forever
  expect(await outbox.size()).toBe(0);
});

test('without onConflict the server copy is applied via onRecords', async () => {
  const applied: SyncRecord[] = [];
  const { api, outbox, engine } = setup({
    onRecords: (records: SyncRecord[]) => {
      applied.push(...records);
    },
  });
  await outbox.enqueue({
    entity: 'note',
    id: 'n1',
    updated_at: 100,
    deleted: false,
    payload: '{}',
  });
  const winner = record('n1', 9);
  api.pushResult = {
    results: [
      {
        entity: 'note',
        id: 'n1',
        status: 'stale',
        rev: 9,
        updated_at: winner.updated_at,
        current: winner,
      },
    ],
    server_rev: 9,
  };

  await engine.syncOnce();
  expect(applied).toHaveLength(1);
  expect(applied[0].rev).toBe(9);
});

test('network failure reports an error outcome and keeps local data', async () => {
  const errors: ServerApiError[] = [];
  const { api, outbox, stateStore, engine } = setup({
    onError: (err: ServerApiError) => errors.push(err),
  });
  await outbox.enqueue({
    entity: 'note',
    id: 'n1',
    updated_at: 100,
    deleted: false,
    payload: '{"text":"precious"}',
  });
  api.error = new ServerApiError(0, 'network', 'offline');

  const outcome = await engine.syncOnce();

  expect(outcome.status).toBe('error');
  expect(outcome.error!.code).toBe('network');
  expect(errors).toHaveLength(1);
  // nothing lost: the outbox still holds the change, the cursor did not move
  expect(await outbox.size()).toBe(1);
  expect((await stateStore.get()).last_rev).toBe(0);
});

test('overlapping sync calls are skipped', async () => {
  const { engine } = setup();
  // make the first call hang on pull
  const gate = { release: () => undefined as void };
  const blocked = new Promise<void>((resolve) => {
    gate.release = resolve;
  });

  const engine2 = engine as any;
  const originalPull = engine2.api;
  let firstStarted = false;
  originalPull.pull = async (since: number) => {
    if (!firstStarted) {
      firstStarted = true;
      await blocked;
    }
    return { records: [], next_rev: since, has_more: false, server_rev: 0 };
  };

  const first = engine.syncOnce();
  const second = await engine.syncOnce();
  expect(second.status).toBe('skipped');

  gate.release();
  const firstOutcome = await first;
  expect(firstOutcome.status).toBe('ok');
});

test('fullSync resets the cursor before pulling', async () => {
  const { api, stateStore, engine } = setup();
  await stateStore.set({ last_rev: 999 });

  await engine.fullSync();

  expect(api.pullCalls[0]).toBe(0);
  expect((await stateStore.get()).last_rev).toBe(0);
});
