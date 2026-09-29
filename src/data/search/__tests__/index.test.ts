import { MemoryStorageArea } from '../../repo/outbox';
import { Query } from '../Query';
import { SYNC_CONFIG_KEY } from '../../repo/syncConfig';
import { db } from '../../../storage/db';
import { loadTabSpacesByIds } from '../../tabSpace/util';
import { searchSavedTabSpaces } from '../index';
import { resetTestDb } from '../../../dev/dbImplTest';

function savedTabSpace(id: string, name: string, tabIds: string[] = []) {
  return {
    id,
    name,
    tabIds,
    version: 10,
    createdAt: 1,
    updatedAt: 1,
  };
}

function savedTab(id: string, tabSpaceId: string, title: string) {
  return {
    id,
    tabSpaceId,
    title,
    url: `https://example.com/${id}`,
    favIconUrl: '',
    pinned: false,
    suspended: false,
    version: 10,
    createdAt: 1,
    updatedAt: 1,
  };
}

const query = (term: string) =>
  new Query({ andQueries: [{ scope: {}, terms: [term] }] });

function pairedStorage() {
  const storage = new MemoryStorageArea();
  storage.set({
    [SYNC_CONFIG_KEY]: {
      baseUrl: 'http://server',
      token: 'tok',
      enabled: true,
    },
  });
  return storage;
}

function serverFetch(hits: any[]) {
  return async () => ({
    status: 200,
    json: async () => ({ query: 'q', hits }),
  });
}

beforeEach(async () => {
  await resetTestDb();
  await db
    .table('SavedTabSpace')
    .bulkPut([
      savedTabSpace('ts-local', 'Weeknight recipes', ['t1']),
      savedTabSpace('ts-other', 'Java notes', ['t2']),
    ]);
  await db
    .table('SavedTab')
    .bulkPut([
      savedTab('t1', 'ts-local', 'Pasta basics'),
      savedTab('t2', 'ts-other', 'Virtual threads'),
    ]);
});

test('without a server the local tables answer', async () => {
  const storage = new MemoryStorageArea();
  const result = await searchSavedTabSpaces(query('pasta'), { storage });
  expect(result.backend).toBe('local');
  expect(result.tabSpaces.map((t) => t.id)).toEqual(['ts-local']);
  expect(result.unknownTabSpaceIds).toEqual([]);
});

test('a search result is a tabverse with its tabs', async () => {
  const storage = new MemoryStorageArea();
  const result = await searchSavedTabSpaces(query('pasta'), { storage });
  expect(result.tabSpaces[0].name).toEqual('Weeknight recipes');
  expect(result.tabSpaces[0].tabs.size).toBe(1);
  expect(result.tabSpaces[0].tabs.first().title).toEqual('Pasta basics');
});

test('with a paired server the server answers, ranked order kept', async () => {
  const fetchFn = serverFetch([
    { entity: 'tab', id: 't2', score: 2, tabspace_id: 'ts-other' },
    { entity: 'tab', id: 't1', score: 1, tabspace_id: 'ts-local' },
  ]);
  const result = await searchSavedTabSpaces(query('pasta'), {
    storage: pairedStorage(),
    fetchFn,
  });
  expect(result.backend).toBe('server');
  expect(result.tabSpaces.map((t) => t.id)).toEqual(['ts-other', 'ts-local']);
});

test('hits for tabverses this device does not have are dropped and reported', async () => {
  const fetchFn = serverFetch([
    { entity: 'tab', id: 't99', score: 2, tabspace_id: 'ts-remote' },
    { entity: 'tab', id: 't1', score: 1, tabspace_id: 'ts-local' },
  ]);
  const result = await searchSavedTabSpaces(query('pasta'), {
    storage: pairedStorage(),
    fetchFn,
  });
  expect(result.tabSpaces.map((t) => t.id)).toEqual(['ts-local']);
  expect(result.unknownTabSpaceIds).toEqual(['ts-remote']);
});

test('a server that is down falls back to the local scan', async () => {
  const fetchFn = async () => {
    throw new Error('network down');
  };
  const result = await searchSavedTabSpaces(query('pasta'), {
    storage: pairedStorage(),
    fetchFn,
  });
  expect(result.backend).toBe('local');
  expect(result.tabSpaces.map((t) => t.id)).toEqual(['ts-local']);
});

test('a server that answers with an error falls back too', async () => {
  const fetchFn = async () => ({
    status: 500,
    json: async () => ({ error: 'http_error', message: 'boom' }),
  });
  const result = await searchSavedTabSpaces(query('pasta'), {
    storage: pairedStorage(),
    fetchFn,
  });
  expect(result.backend).toBe('local');
  expect(result.tabSpaces.map((t) => t.id)).toEqual(['ts-local']);
});

test('sync disabled means local, even with credentials stored', async () => {
  const storage = new MemoryStorageArea();
  await storage.set({
    [SYNC_CONFIG_KEY]: {
      baseUrl: 'http://server',
      token: 'tok',
      enabled: false,
    },
  });
  let called = false;
  const result = await searchSavedTabSpaces(query('pasta'), {
    storage,
    fetchFn: async () => {
      called = true;
      return { status: 200, json: async () => ({ query: '', hits: [] }) };
    },
  });
  expect(called).toBe(false);
  expect(result.backend).toBe('local');
  expect(result.tabSpaces.length).toBe(1);
});

test('an empty query searches nothing', async () => {
  const result = await searchSavedTabSpaces(new Query({ andQueries: [] }), {
    storage: new MemoryStorageArea(),
  });
  expect(result.tabSpaces).toEqual([]);
  expect(result.backend).toBe('local');
});

test('loadTabSpacesByIds keeps the given order and skips unknown ids', async () => {
  const tabSpaces = await loadTabSpacesByIds(['ts-other', 'nope', 'ts-local']);
  expect(tabSpaces.map((t) => t.id)).toEqual(['ts-other', 'ts-local']);
  expect(await loadTabSpacesByIds([])).toEqual([]);
});
