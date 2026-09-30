import {
  createSyncRuntime,
  startBackgroundSync,
  stopBackgroundSyncForTest,
  uploadAllLocalRecords,
} from '../backgroundSync';
import { db } from '../../../storage/db';
import { resetTestDb } from '../../../dev/dbImplTest';
import { MemoryStorageArea, Outbox } from '../outbox';
import { MemorySyncStateStore } from '../repo';
import { FetchLike, HttpResponseLike } from '../serverApi';
import { WebSocketLike } from '../realtime';
import { SYNC_CONFIG_KEY, SyncConfig } from '../syncConfig';

class FakeWebSocket implements WebSocketLike {
  onopen: ((ev?: any) => void) | null = null;
  onmessage: ((ev: { data: any }) => void) | null = null;
  onclose: ((ev?: any) => void) | null = null;
  onerror: ((ev?: any) => void) | null = null;
  closed = false;

  send(): void {
    /* not needed */
  }

  close(): void {
    this.closed = true;
    if (this.onclose) {
      this.onclose({});
    }
  }
}

function jsonResponse(data: any, status = 200): HttpResponseLike {
  return { status, json: async () => data };
}

const CONFIG: SyncConfig = {
  baseUrl: 'https://sync.example.com',
  token: 'device-token',
  userId: 'usr_1',
  deviceId: 'dev_1',
  enabled: true,
};

async function setup(configured: boolean) {
  const storage = new MemoryStorageArea();
  if (configured) {
    await storage.set({ [SYNC_CONFIG_KEY]: CONFIG });
  }
  const sockets: FakeWebSocket[] = [];
  const calls: Array<{ url: string; headers: any; body?: string }> = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({
      url,
      headers: (init && init.headers) || {},
      body: init && init.body,
    });
    return jsonResponse({
      records: [],
      next_rev: 0,
      has_more: false,
      server_rev: 0,
    });
  };

  const runtime = createSyncRuntime(CONFIG, {
    storage,
    fetchFn,
    webSocketFactory: () => {
      const s = new FakeWebSocket();
      sockets.push(s);
      return s;
    },
    stateStore: new MemorySyncStateStore(),
    autoSyncIntervalMs: 0, // no timers in tests
  });
  return { runtime, sockets, calls, storage, fetchFn };
}

afterEach(() => {
  stopBackgroundSyncForTest();
});

test('runtime connects realtime and pulls with the device token', async () => {
  const { runtime, sockets, calls } = await setup(true);

  expect(sockets).toHaveLength(1);
  expect(runtime.realtime).not.toBeNull();

  await runtime.syncNow();

  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe('https://sync.example.com/api/v1/sync?since=0');
  expect(calls[0].headers.Authorization).toBe('Bearer device-token');

  runtime.stop();
  expect(sockets[0].closed).toBe(true);
});

test('stop does not leave periodic sync running', async () => {
  const { runtime } = await setup(true);
  // interval 0 => startAutoSync was never called; stopping must not throw
  expect(() => runtime.stop()).not.toThrow();
});

test('startBackgroundSync is a no-op when not configured', async () => {
  const storage = new MemoryStorageArea();
  const sockets: FakeWebSocket[] = [];

  const runtime = await startBackgroundSync({
    storage,
    webSocketFactory: () => {
      const s = new FakeWebSocket();
      sockets.push(s);
      return s;
    },
    autoSyncIntervalMs: 0,
  });

  expect(runtime).toBeNull();
  expect(sockets).toHaveLength(0);
});

test('startBackgroundSync starts once and is idempotent', async () => {
  await resetTestDb();
  const storage = new MemoryStorageArea();
  await storage.set({ [SYNC_CONFIG_KEY]: CONFIG });
  const sockets: FakeWebSocket[] = [];

  const deps = {
    storage,
    fetchFn: (async () =>
      jsonResponse({
        records: [],
        next_rev: 0,
        has_more: false,
        server_rev: 0,
      })) as FetchLike,
    webSocketFactory: () => {
      const s = new FakeWebSocket();
      sockets.push(s);
      return s;
    },
    autoSyncIntervalMs: 0,
  };

  const first = await startBackgroundSync(deps);
  const second = await startBackgroundSync(deps);
  expect(first).not.toBeNull();
  expect(second).toBe(first);
  expect(sockets).toHaveLength(1);

  stopBackgroundSyncForTest();
});

test('uploadAllLocalRecords ships the local database', async () => {
  await resetTestDb();
  await db.table('SavedNote').put({
    id: 'n1',
    tabSpaceId: 'ts1',
    name: 'ship me',
    data: 'body',
    version: 7,
    createdAt: 1,
    updatedAt: 2,
  });

  const pushes: any[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    if (init && init.method === 'POST') {
      const body = JSON.parse(init.body!);
      pushes.push(body);
      return jsonResponse({
        results: body.records.map((r: any) => ({
          entity: r.entity,
          id: r.id,
          status: 'ok',
          rev: 1,
          updated_at: r.updated_at,
        })),
        server_rev: 1,
      });
    }
    return jsonResponse({
      records: [],
      next_rev: 0,
      has_more: false,
      server_rev: 1,
    });
  };

  const { runtime } = await setup(true);
  // swap the engine's fetch for the recording one
  const uploadRuntime = createSyncRuntime(CONFIG, {
    storage: new MemoryStorageArea(),
    fetchFn,
    stateStore: new MemorySyncStateStore(),
    autoSyncIntervalMs: 0,
  });
  runtime.stop();

  const progress: Array<[number, number]> = [];
  const uploaded = await uploadAllLocalRecords(uploadRuntime.engine, {
    onProgress: (done, total) => progress.push([done, total]),
  });
  expect(uploaded).toEqual({ uploaded: 1, stale: 0, total: 1 });
  // progress is reported per chunk, so a large first upload can show a count
  expect(progress).toEqual([[1, 1]]);
  expect(pushes).toHaveLength(1);
  expect(pushes[0].records[0]).toMatchObject({
    entity: 'note',
    id: 'n1',
    updated_at: 2,
    deleted: false,
  });
  expect(JSON.parse(pushes[0].records[0].payload)).toMatchObject({
    name: 'ship me',
  });
  uploadRuntime.stop();
});

test('uploadAllLocalRecords reports stale records and chunked progress', async () => {
  // Pairing now uploads by default, and the dialog tells the user what
  // happened. "Stale" is not a failure: the server already held a newer copy,
  // so nothing was lost, but the count has to be reported separately from the
  // number that was actually written.
  await resetTestDb();
  await db.table('SavedNote').bulkPut(
    Array.from({ length: 250 }, (_, i) => ({
      id: `n${i}`,
      tabSpaceId: 'ts1',
      name: `note ${i}`,
      data: 'body',
      version: 7,
      createdAt: 1,
      updatedAt: 2,
    })),
  );

  const fetchFn: FetchLike = async (url, init) => {
    if (init && init.method === 'POST') {
      const body = JSON.parse(init.body!);
      return jsonResponse({
        // one stale per chunk, so the accounting is exercised more than once
        results: body.records.map((r: any, i: number) => ({
          entity: r.entity,
          id: r.id,
          status: i === 0 ? 'stale' : 'ok',
          rev: 1,
          updated_at: r.updated_at,
        })),
        server_rev: 1,
      });
    }
    return jsonResponse({
      records: [],
      next_rev: 0,
      has_more: false,
      server_rev: 1,
    });
  };

  const uploadRuntime = createSyncRuntime(CONFIG, {
    storage: new MemoryStorageArea(),
    fetchFn,
    stateStore: new MemorySyncStateStore(),
    autoSyncIntervalMs: 0,
  });

  const progress: Array<[number, number]> = [];
  const result = await uploadAllLocalRecords(uploadRuntime.engine, {
    onProgress: (done, total) => progress.push([done, total]),
  });
  expect(result).toEqual({ uploaded: 247, stale: 3, total: 250 });
  // 250 records at 100 per chunk: 100, 200, 250
  expect(progress).toEqual([
    [100, 250],
    [200, 250],
    [250, 250],
  ]);
  uploadRuntime.stop();
});

test('outbox survives a network failure during flush', async () => {
  const storage = new MemoryStorageArea();
  const outbox = new Outbox(storage);
  await outbox.enqueue({
    entity: 'note',
    id: 'n1',
    updated_at: 10,
    deleted: false,
    payload: '{"id":"n1"}',
  });

  const failingFetch: FetchLike = async () => {
    throw new Error('offline');
  };
  const runtime = createSyncRuntime(CONFIG, {
    storage,
    fetchFn: failingFetch,
    stateStore: new MemorySyncStateStore(),
    autoSyncIntervalMs: 0,
  });

  const outcome = await runtime.engine.syncOnce();
  expect(outcome.status).toBe('error');
  expect(outcome.error!.code).toBe('network');
  // the queued change is still there, nothing was lost
  expect(await outbox.size()).toBe(1);
  runtime.stop();
});
