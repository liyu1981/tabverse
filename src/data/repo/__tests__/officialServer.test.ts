/**
 * The official-server wizard from the extension's side (adr/0020).
 *
 * What is checked here is the part that can be checked without a browser: the
 * URL the window is opened with, and the rules a token message has to pass. The
 * rules are the security of the flow - a message that did not answer a pairing
 * this device started, from the official server, with a token in it, is not
 * allowed to write the sync config.
 */

import { expect, test } from 'vitest';
import {
  acceptPairCredentials,
  closePairWindow,
  newPairNonce,
  officialPairUrl,
  OFFICIAL_SERVER_ORIGIN,
  OFFICIAL_SERVER_URL,
  openOfficialPairWindow,
  PAIR_CREDENTIALS_MESSAGE,
  PairCredentialsMessage,
  rememberPendingPair,
  senderOrigin,
  takePendingPair,
} from '../officialServer';

const CREDENTIALS = {
  user_id: 'usr_1',
  device_id: 'dev_1',
  token: 'plain-secret',
  server_rev: 0,
  issued_at: 1,
};

/** A storage.session stand-in - the nonce has to survive between contexts. */
function memorySession() {
  const store = new Map<string, unknown>();
  return {
    store,
    area: {
      get: async (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of list) {
          if (store.has(k)) out[k] = store.get(k);
        }
        return out;
      },
      set: async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) store.set(k, v);
      },
      remove: async (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys];
        list.forEach((k) => {
          store.delete(k);
        });
      },
    },
  };
}

test('the window URL carries the extension id and a nonce, in the query', () => {
  const url = officialPairUrl('abcdefghijklmnoabcdefhijklmnoabc', 'n-1');
  expect(url.startsWith(`${OFFICIAL_SERVER_URL}/console?`)).toBe(true);
  // on the console's own page, as a plain HTTP URL (adr/0023)
  expect(url).not.toContain('#');
  expect(url).toContain('pair=1');
  expect(url).toContain('ext=abcdefghijklmnoabcdefhijklmnoabc');
  expect(url).toContain('nonce=n-1');
});

test('a nonce is fresh every time', () => {
  expect(newPairNonce()).not.toEqual(newPairNonce());
  expect(newPairNonce().length).toBeGreaterThan(8);
});

test('a pairing is answerable once, and only while it is fresh', async () => {
  const { area } = memorySession();
  await rememberPendingPair('n-1', area);
  expect((await takePendingPair(area))?.nonce).toEqual('n-1');
  // spent: a second answer is not answerable
  expect(await takePendingPair(area)).toBeNull();

  // and an old one is not answerable at all
  await rememberPendingPair('n-2', area, Date.now() - 11 * 60 * 1000);
  expect(await takePendingPair(area)).toBeNull();
});

test('a token message from the official server is accepted and saved', async () => {
  const { area } = memorySession();
  await rememberPendingPair('n-1', area);
  let saved: { baseUrl: string; token: string } | null = null;
  let notified = false;

  const accepted = await acceptPairCredentials(
    {
      type: PAIR_CREDENTIALS_MESSAGE,
      nonce: 'n-1',
      baseUrl: OFFICIAL_SERVER_URL,
      credentials: CREDENTIALS,
    } as PairCredentialsMessage,
    { origin: OFFICIAL_SERVER_ORIGIN },
    {
      storage: area,
      save: async (baseUrl, credentials) => {
        saved = { baseUrl, token: credentials.token };
      },
      notify: () => {
        notified = true;
      },
    },
  );

  expect(accepted).toBe(true);
  expect(saved).toEqual({
    baseUrl: OFFICIAL_SERVER_URL,
    token: 'plain-secret',
  });
  expect(notified).toBe(true);
});

test('a message that answers nothing is refused', async () => {
  // no pairing was started: nothing to match, so nothing is written
  const { area } = memorySession();
  let saved = false;
  const accepted = await acceptPairCredentials(
    {
      type: PAIR_CREDENTIALS_MESSAGE,
      nonce: 'n-1',
      baseUrl: OFFICIAL_SERVER_URL,
      credentials: CREDENTIALS,
    } as PairCredentialsMessage,
    { origin: OFFICIAL_SERVER_ORIGIN },
    {
      storage: area,
      save: async () => {
        saved = true;
      },
    },
  );
  expect(accepted).toBe(false);
  expect(saved).toBe(false);
});

test('a message with the wrong nonce is refused and spends nothing else', async () => {
  const { area } = memorySession();
  await rememberPendingPair('n-1', area);
  const accepted = await acceptPairCredentials(
    {
      type: PAIR_CREDENTIALS_MESSAGE,
      nonce: 'not-the-one',
      baseUrl: OFFICIAL_SERVER_URL,
      credentials: CREDENTIALS,
    } as PairCredentialsMessage,
    { origin: OFFICIAL_SERVER_ORIGIN },
    { storage: area },
  );
  expect(accepted).toBe(false);
});

test('a message from another origin is refused even with a good nonce', async () => {
  // The manifest already narrows who may send; this is the same rule where the
  // code can see it, and it also covers a page that got the API some other way.
  const { area } = memorySession();
  await rememberPendingPair('n-1', area);
  const accepted = await acceptPairCredentials(
    {
      type: PAIR_CREDENTIALS_MESSAGE,
      nonce: 'n-1',
      baseUrl: 'https://elsewhere.example',
      credentials: CREDENTIALS,
    } as PairCredentialsMessage,
    { origin: 'https://elsewhere.example' },
    { storage: area },
  );
  expect(accepted).toBe(false);
});

test('a message without a token is refused', async () => {
  const { area } = memorySession();
  await rememberPendingPair('n-1', area);
  const accepted = await acceptPairCredentials(
    {
      type: PAIR_CREDENTIALS_MESSAGE,
      nonce: 'n-1',
      baseUrl: OFFICIAL_SERVER_URL,
      credentials: { ...CREDENTIALS, token: '' },
    } as PairCredentialsMessage,
    { origin: OFFICIAL_SERVER_ORIGIN },
    { storage: area },
  );
  expect(accepted).toBe(false);
});

test('something that is not our message is ignored without touching storage', async () => {
  const { area } = memorySession();
  await rememberPendingPair('n-1', area);
  expect(
    await acceptPairCredentials(
      { type: 'something_else' },
      { origin: OFFICIAL_SERVER_ORIGIN },
      { storage: area },
    ),
  ).toBe(false);
  // the pending pairing survives a message that was not ours
  expect((await takePendingPair(area))?.nonce).toEqual('n-1');
});

test('the origin of a sender is read from its url when it has no origin', () => {
  expect(senderOrigin({ origin: 'https://a.example' })).toEqual(
    'https://a.example',
  );
  expect(senderOrigin({ url: 'https://b.example/console?pair=1' })).toEqual(
    'https://b.example',
  );
  expect(senderOrigin({})).toEqual('');
  expect(senderOrigin(undefined)).toEqual('');
});

test('opening the wizard returns the window it made, and closing it is safe', async () => {
  const created: any[] = [];
  const removed: number[] = [];
  const windows = {
    create: async (data: any) => {
      created.push(data);
      return { id: 42 };
    },
    remove: async (id: number) => {
      removed.push(id);
    },
  };

  const id = await openOfficialPairWindow(
    'https://tabversed.liyu1981.xyz/console?pair=1',
    { windows },
  );
  expect(id).toEqual(42);
  expect(created[0].url).toContain('pair=1');

  await closePairWindow(id, { windows });
  expect(removed).toEqual([42]);
  // closing nothing is not an error
  await closePairWindow(null);
});
