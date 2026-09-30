import {
  FetchLike,
  HttpResponseLike,
  ServerApiClient,
  ServerApiError,
} from '../serverApi';
import { RecordInput } from '../types';

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function jsonResponse(data: any, status = 200): HttpResponseLike {
  return {
    status,
    json: async () => data,
  };
}

/** fetch stub that records calls and replays canned responses in order. */
function makeFetch(responses: Array<() => HttpResponseLike>) {
  const calls: RecordedCall[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: (init && init.method) || 'GET',
      headers: (init && init.headers) || {},
      body: init && init.body,
    });
    if (responses.length === 0) {
      throw new Error('no canned response left for ' + url);
    }
    return responses.shift()!();
  };
  return { fetchFn, calls };
}

const BASE = 'https://sync.example.com/';

test('pull builds the delta URL and sends the bearer token', async () => {
  const { fetchFn, calls } = makeFetch([
    () =>
      jsonResponse({
        records: [],
        next_rev: 42,
        has_more: false,
        server_rev: 42,
      }),
  ]);
  const api = new ServerApiClient({ baseUrl: BASE, token: 'tok', fetchFn });

  const res = await api.pull(41, 100);

  expect(res.next_rev).toBe(42);
  expect(calls).toHaveLength(1);
  // trailing slash of the base url is normalized exactly once
  expect(calls[0].url).toBe(
    'https://sync.example.com/api/v1/sync?since=41&limit=100',
  );
  expect(calls[0].method).toBe('GET');
  expect(calls[0].headers.Authorization).toBe('Bearer tok');
  expect(calls[0].body).toBeUndefined();
});

test('push serializes records as JSON', async () => {
  const { fetchFn, calls } = makeFetch([
    () => jsonResponse({ results: [], server_rev: 7 }),
  ]);
  const api = new ServerApiClient({ baseUrl: BASE, token: 'tok', fetchFn });

  const records: RecordInput[] = [
    {
      entity: 'note',
      id: 'n1',
      updated_at: 123,
      deleted: false,
      payload: '{"text":"hi"}',
    },
  ];
  const res = await api.push(records);

  expect(res.server_rev).toBe(7);
  expect(calls[0].method).toBe('POST');
  expect(calls[0].headers['Content-Type']).toBe('application/json');
  expect(JSON.parse(calls[0].body!)).toEqual({ records });
});

test('push with no records does not hit the network', async () => {
  const { fetchFn, calls } = makeFetch([]);
  const api = new ServerApiClient({ baseUrl: BASE, token: 'tok', fetchFn });
  const res = await api.push([]);
  expect(calls).toHaveLength(0);
  expect(res.results).toEqual([]);
});

test('server errors become ServerApiError with code and status', async () => {
  const { fetchFn } = makeFetch([
    () => jsonResponse({ error: 'invalid_token', message: 'nope' }, 401),
  ]);
  const api = new ServerApiClient({ baseUrl: BASE, token: 'bad', fetchFn });

  let caught: any;
  try {
    await api.pull(0);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ServerApiError);
  expect(caught.status).toBe(401);
  expect(caught.code).toBe('invalid_token');
  expect(caught.message).toBe('nope');
  expect(caught.isAuthError).toBe(true);
});

test('network failure maps to status 0 / code network', async () => {
  const fetchFn: FetchLike = async () => {
    throw new Error('ECONNREFUSED');
  };
  const api = new ServerApiClient({ baseUrl: BASE, token: 'tok', fetchFn });

  let caught: any;
  try {
    await api.pull(0);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ServerApiError);
  expect(caught.status).toBe(0);
  expect(caught.code).toBe('network');
  expect(caught.isAuthError).toBe(false);
});

test('a rejected fetch on the pairing call says what to check', async () => {
  // Chrome reports a CSP-blocked host as the same "Failed to fetch" as a dead
  // server, and pairing is the one call where the user has just typed a URL by
  // hand (ADR 0010), so the message has to name the likely causes.
  const fetchFn: FetchLike = async () => {
    throw new Error('Failed to fetch');
  };

  let caught: any;
  try {
    await ServerApiClient.pair(BASE, 'AAAA-BBBB-CCCC-DDDD', 'laptop', fetchFn);
  } catch (err) {
    caught = err;
  }
  expect(caught.code).toBe('network');
  expect(caught.message).toContain('network error for POST /api/v1/auth/pair');
  expect(caught.message).toContain('scheme, host and port');
  expect(caught.message).toContain('older build');
});

test('search encodes the query and optional filters', async () => {
  const { fetchFn, calls } = makeFetch([
    () => jsonResponse({ query: 'a b', hits: [] }),
    () => jsonResponse({ query: 'x', hits: [] }),
  ]);
  const api = new ServerApiClient({ baseUrl: BASE, token: 'tok', fetchFn });

  await api.search('a b&c', { entity: 'note', limit: 10 });
  await api.search('x');

  expect(calls[0].url).toBe(
    'https://sync.example.com/api/v1/search?q=a%20b%26c&entity=note&limit=10',
  );
  expect(calls[1].url).toBe('https://sync.example.com/api/v1/search?q=x');
});

test('bootstrap and pair are unauthenticated POSTs', async () => {
  const { fetchFn, calls } = makeFetch([
    () =>
      jsonResponse({
        user_id: 'u',
        device_id: 'd',
        token: 't',
        server_rev: 0,
      }),
    () =>
      jsonResponse({
        user_id: 'u',
        device_id: 'd2',
        token: 't2',
        server_rev: 0,
      }),
  ]);

  const creds = await ServerApiClient.bootstrap(BASE, 'yli', fetchFn);
  expect(creds.token).toBe('t');
  expect(calls[0].url).toBe('https://sync.example.com/api/v1/auth/bootstrap');
  expect(calls[0].headers.Authorization).toBeUndefined();
  expect(JSON.parse(calls[0].body!)).toEqual({ name: 'yli' });

  const paired = await ServerApiClient.pair(
    BASE,
    'ABCD-EFGH',
    'laptop',
    fetchFn,
  );
  expect(paired.token).toBe('t2');
  expect(JSON.parse(calls[1].body!)).toEqual({
    invite_code: 'ABCD-EFGH',
    device_name: 'laptop',
  });
});

test('bootstrap conflict surfaces as 409 already_bootstrapped', async () => {
  const { fetchFn } = makeFetch([
    () =>
      jsonResponse({ error: 'already_bootstrapped', message: 'locked' }, 409),
  ]);
  let caught: any;
  try {
    await ServerApiClient.bootstrap(BASE, 'x', fetchFn);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ServerApiError);
  expect(caught.status).toBe(409);
  expect(caught.code).toBe('already_bootstrapped');
  expect(caught.isAuthError).toBe(false);
});

test('streamUrl maps http(s) to ws(s) and carries the token', () => {
  const api = new ServerApiClient({
    baseUrl: 'https://sync.example.com',
    token: 'a b/c',
    fetchFn: async () => jsonResponse({}),
  });
  expect(api.streamUrl()).toBe(
    'wss://sync.example.com/api/v1/sync/stream?access_token=a%20b%2Fc',
  );
});
