import { expect, test, vi } from 'vitest';

import { ApiError, createConsoleApi } from './api';

/**
 * The client is the console's whole boundary with the server, so what is checked
 * here is the shape of every call it makes: the method, the path, the query it
 * leaves out, and what an error becomes. The fetches are stubbed, so nothing
 * here can reach a network.
 */

interface Call {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

function stub(
  answers: Record<string, { status?: number; body?: unknown }> = {},
): { calls: Call[]; api: ReturnType<typeof createConsoleApi> } {
  const calls: Call[] = [];
  const api = createConsoleApi(async (url, init) => {
    calls.push({
      url,
      method: init?.method || 'GET',
      headers: init?.headers,
      body: init?.body,
    });
    const key = Object.keys(answers).find((path) => url.startsWith(path));
    const answer = key ? answers[key] : {};
    const status = answer.status ?? 200;
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () =>
        answer.body === undefined ? '' : JSON.stringify(answer.body),
    };
  });
  return { calls, api };
}

test('a 204 is a null result, not a parse error', async () => {
  const { api } = stub({ '/console/api/v1/console/signout': { status: 204 } });
  await expect(api.signOut()).resolves.toBeNull();
});

test('the deployment config is one unauthenticated GET', async () => {
  const { calls, api } = stub({
    '/console/api/v1/admin/config': {
      body: { admin_enabled: true, version: '0.5.0' },
    },
  });
  await expect(api.getConfig()).resolves.toEqual({
    admin_enabled: true,
    version: '0.5.0',
  });
  expect(calls[0]).toMatchObject({
    method: 'GET',
    url: '/console/api/v1/admin/config',
  });
});

test('an unauthorized "who am I" is null, not a thrown error', async () => {
  // Boot has one branch for "nobody is signed in" and one for "the server
  // cannot say"; both come back as null, and the page shows the sign-in form.
  const { api } = stub({
    '/console/api/v1/console/me': {
      status: 401,
      body: { error: 'unauthorized' },
    },
  });
  await expect(api.whoAmI()).resolves.toBeNull();
});

test('an error keeps the status and the code the server sent', async () => {
  const { api } = stub({
    '/console/api/v1/admin/users/usr_1/tabspaces/ts_9': {
      status: 404,
      body: { error: 'not_found', message: 'no such tabverse' },
    },
  });
  await expect(api.getTabspace('usr_1', 'ts_9')).rejects.toMatchObject({
    status: 404,
    code: 'not_found',
    message: 'no such tabverse',
  });
});

test('a body that is not json is an error, with enough of it to read', async () => {
  const api = createConsoleApi(async () => ({
    status: 502,
    ok: false,
    text: async () => '<html>bad gateway</html>',
  }));
  const error = await api.getConfig().catch((e) => e as ApiError);
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(502);
});

test('the XSRF token is echoed on writes and never on reads', async () => {
  const { calls, api } = stub();
  api.setCsrf('X-Csrf-Token', 'tok');
  await api.getUser('usr_1');
  await api.renameUser('usr_1', 'new name');
  expect(calls[0].headers).toEqual({});
  expect(calls[1].headers).toEqual({
    'Content-Type': 'application/json',
    'X-Csrf-Token': 'tok',
  });
  expect(JSON.parse(calls[1].body as string)).toEqual({ name: 'new name' });
});

test('the sign-in link carries the address in the query, as the library reads it', async () => {
  // A POST body is ignored by the library: getting this wrong is a bare 400
  // with nothing to explain it. Lowercasing the address is the action's job
  // (one place decides how an address is normalised), and this only has to put
  // the three fields where the library looks for them.
  const calls: Call[] = [];
  const api = createConsoleApi(async (url, init) => {
    calls.push({ url, method: init?.method || 'GET', body: init?.body });
    return { status: 200, ok: true, text: async () => '' };
  });
  vi.stubGlobal('window', { location: { origin: 'http://tabverse.lan:8223' } });
  await api.requestSigninLink('person@example.com');
  expect(calls[0].url).toContain('address=person%40example.com');
  expect(calls[0].url).toContain('user=person%40example.com');
  expect(calls[0].url).toContain('site=http%3A%2F%2Ftabverse.lan%3A8223');
  expect(calls[0].method).toBe('POST');
  vi.unstubAllGlobals();
});

test('a delete sends the id back as the confirmation the server demands', async () => {
  const { calls, api } = stub();
  await api.deleteUser('usr_1');
  await api.deleteTabspace('usr_1', 'ts_2');
  expect(calls[0].url).toBe('/console/api/v1/admin/users/usr_1?confirm=usr_1');
  expect(calls[1].url).toBe(
    '/console/api/v1/admin/users/usr_1/tabspaces/ts_2?confirm=ts_2',
  );
  expect(calls.every((call) => call.method === 'DELETE')).toBe(true);
});

test('archiving is a PUT and unarchiving is a DELETE of the same path', async () => {
  const { calls, api } = stub();
  await api.setDeviceArchived('usr_1', 'dev_1', true);
  await api.setDeviceArchived('usr_1', 'dev_1', false);
  await api.setTokenArchived('usr_1', 'hash', true);
  await api.setDeviceRecordsArchived('usr_1', 'dev_1', true);
  expect(calls[0]).toMatchObject({
    method: 'PUT',
    url: '/console/api/v1/admin/users/usr_1/devices/dev_1/archive',
  });
  expect(calls[1]).toMatchObject({ method: 'DELETE' });
  expect(calls[2]).toMatchObject({
    method: 'PUT',
    url: '/console/api/v1/admin/users/usr_1/tokens/hash/archive',
  });
  expect(calls[3].url).toBe(
    '/console/api/v1/admin/users/usr_1/devices/dev_1/records/archive',
  );
});

test('a listing sends only the filters that are on', async () => {
  const { calls, api } = stub();
  await api.listRecords('usr_1', {
    limit: 50,
    offset: 0,
    q: '',
    entity: '',
    deleted: false,
    archived: true,
  });
  // An empty string and a false flag are "off": two filters, not four. The
  // offset goes out as 0 rather than being dropped, because a page that forgets
  // its place is worse than a redundant parameter.
  expect(calls[0].url).toBe(
    '/console/api/v1/admin/users/usr_1/records?limit=50&offset=0&archived=1',
  );
});

test('an id is escaped, not pasted', async () => {
  const { calls, api } = stub();
  await api.getUser('usr/../admin');
  expect(calls[0].url).toBe('/console/api/v1/admin/users/usr%2F..%2Fadmin');
});

test('the directory filter and the user list come back as a list', async () => {
  const { api } = stub({
    '/console/api/v1/admin/users': { body: { users: [{ id: 'usr_1' }] } },
  });
  await expect(api.listUsers('ali')).resolves.toEqual([{ id: 'usr_1' }]);
  await expect(api.listUsers()).resolves.toEqual([{ id: 'usr_1' }]);
});
