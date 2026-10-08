import {
  adoptCredentials,
  clearSyncConfig,
  loadSyncConfig,
  memoryStorage,
  pairWithServer,
  saveSyncConfig,
  SYNC_CONFIG_KEY,
} from '../syncConfig';
import { HttpResponseLike } from '../serverApi';

test('config round trips through storage', async () => {
  const storage = memoryStorage();
  expect(await loadSyncConfig(storage)).toBeNull();

  await saveSyncConfig(
    {
      baseUrl: 'https://sync.example.com',
      token: 'tok',
      userId: 'usr_1',
      deviceId: 'dev_1',
      enabled: true,
    },
    storage,
  );

  const loaded = await loadSyncConfig(storage);
  expect(loaded).toMatchObject({
    baseUrl: 'https://sync.example.com',
    token: 'tok',
    userId: 'usr_1',
    deviceId: 'dev_1',
    enabled: true,
  });

  await clearSyncConfig(storage);
  expect(await loadSyncConfig(storage)).toBeNull();
});

test('malformed stored config is treated as not configured', async () => {
  const storage = memoryStorage();
  await storage.set({ [SYNC_CONFIG_KEY]: { baseUrl: 'https://x' } }); // no token
  expect(await loadSyncConfig(storage)).toBeNull();

  await storage.set({ [SYNC_CONFIG_KEY]: 'garbage' });
  expect(await loadSyncConfig(storage)).toBeNull();
});

test('disabled config is still loaded (so it can be re-enabled)', async () => {
  const storage = memoryStorage();
  await saveSyncConfig(
    { baseUrl: 'https://x', token: 't', enabled: false },
    storage,
  );
  const cfg = await loadSyncConfig(storage);
  expect(cfg).not.toBeNull();
  expect(cfg!.enabled).toBe(false);
});

test('pairWithServer redeems the code and persists credentials', async () => {
  const storage = memoryStorage();
  const calls: Array<{ url: string; body: string }> = [];
  const fetchFn = async (
    url: string,
    init?: any,
  ): Promise<HttpResponseLike> => {
    calls.push({ url, body: init && init.body });
    return {
      status: 201,
      json: async () => ({
        user_id: 'usr_1',
        device_id: 'dev_2',
        token: 'fresh-token',
        server_rev: 12,
      }),
    };
  };

  const config = await pairWithServer(
    'https://sync.example.com/',
    'ABCD-EFGH',
    'laptop',
    storage,
    fetchFn,
  );

  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe(
    'https://sync.example.com/console/api/v1/auth/pair',
  );
  expect(JSON.parse(calls[0].body)).toEqual({
    invite_code: 'ABCD-EFGH',
    device_name: 'laptop',
  });
  expect(config).toMatchObject({
    baseUrl: 'https://sync.example.com',
    token: 'fresh-token',
    userId: 'usr_1',
    deviceId: 'dev_2',
    enabled: true,
  });

  const stored = await loadSyncConfig(storage);
  expect(stored).toEqual(config);
});

test('pair failure leaves no config behind', async () => {
  const storage = memoryStorage();
  const fetchFn = async (): Promise<HttpResponseLike> => ({
    status: 401,
    json: async () => ({ error: 'invalid_invite', message: 'nope' }),
  });

  await expect(
    pairWithServer(
      'https://sync.example.com',
      'WRONG-CODE',
      'x',
      storage,
      fetchFn,
    ),
  ).rejects.toMatchObject({ status: 401, code: 'invalid_invite' });

  expect(await loadSyncConfig(storage)).toBeNull();
});

// ---- the two ways in (adr/0020) -------------------------------------------

test("the wizard's credentials are saved as an official setup", async () => {
  const storage = memoryStorage();
  const config = await adoptCredentials(
    'https://tabversed.liyu1981.xyz/',
    {
      user_id: 'usr_1',
      device_id: 'dev_1',
      token: 'tok-wizard',
      server_rev: 0,
      issued_at: 1,
    },
    storage,
  );

  expect(config.kind).toEqual('official');
  expect(config.baseUrl).toEqual('https://tabversed.liyu1981.xyz'); // no trailing slash
  // and it is the same config shape the sync runtime reads: nothing about the
  // wizard changes what the worker does with it
  const loaded = await loadSyncConfig(storage);
  expect(loaded).toMatchObject({
    baseUrl: 'https://tabversed.liyu1981.xyz',
    token: 'tok-wizard',
    enabled: true,
    kind: 'official',
  });
});

test('a code pairing says custom, and a config written before the wizard says custom too', async () => {
  const storage = memoryStorage();
  const config = await pairWithServer(
    'http://192.168.0.221:8223/',
    'CODE',
    'chrome',
    storage,
    async () =>
      ({
        status: 201,
        json: async () => ({
          user_id: 'usr_1',
          device_id: 'dev_1',
          token: 'tok',
          server_rev: 0,
          issued_at: 1,
        }),
      }) as any,
  );
  expect(config.kind).toEqual('custom');

  // every config that already exists was a code pairing, and it has no field
  // saying so - loading one must not report it as something it was not
  const legacy = {
    baseUrl: 'https://old.example',
    token: 'old-tok',
    enabled: true,
    // no kind
  };
  await saveSyncConfig(legacy, storage);
  const loaded = await loadSyncConfig(storage);
  expect(loaded?.kind).toEqual('custom');
});
