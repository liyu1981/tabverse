import { expect, test } from 'vitest';

import {
  PairRequest,
  readPairRequest,
  runPairFlow,
  sendCredentialsToExtension,
  stashPairRequest,
  takeStashedPairRequest,
} from './pair';
import { setApi } from './api';
import type { ConsoleApi } from './api';
import type { DeviceCredentials } from './types';

/**
 * The wizard the extension opens (adr/0020), tested where it has no DOM: the
 * URL it reads, the message it sends, the four answers it can have, and the
 * stash that survives a sign-in round trip. The page around it is markup, and
 * the server that issues the token is tested in Go.
 */

const REQUEST: PairRequest = {
  extensionId: 'abcdefghijklmnoabcdefhijklmnoabc',
  nonce: 'n-123',
};

const CREDENTIALS: DeviceCredentials = {
  user_id: 'usr_1',
  device_id: 'dev_1',
  token: 'plain-secret',
  server_rev: 0,
  issued_at: '2026-10-01T00:00:00Z',
};

function apiWith(patch: Partial<ConsoleApi> = {}): ConsoleApi {
  const stub = {
    pairExtension: async () => CREDENTIALS,
    ...patch,
  } as unknown as ConsoleApi;
  setApi(stub);
  return stub;
}

test('the pair parameters are read out of the fragment', () => {
  expect(
    readPairRequest('#pair=1&ext=abcdefghijklmnoabcdefhijklmnoabc&nonce=n-1'),
  ).toEqual({ extensionId: 'abcdefghijklmnoabcdefhijklmnoabc', nonce: 'n-1' });
  // no pair, or a pair without the two things that make one, is not a request
  expect(readPairRequest('#user=usr_1')).toBeNull();
  expect(readPairRequest('#pair=1&nonce=n-1')).toBeNull();
  expect(readPairRequest('#pair=1&ext=abc')).toBeNull();
  expect(readPairRequest('')).toBeNull();
});

test('the flow mints a device and sends the token to the extension', async () => {
  const api = apiWith();
  const sent: { request: PairRequest; credentials: DeviceCredentials }[] = [];
  const outcome = await runPairFlow(
    REQUEST,
    'alice laptop',
    async (req, creds) => {
      sent.push({ request: req, credentials: creds });
      return { ok: true };
    },
  );

  expect(outcome).toEqual({ kind: 'sent', credentials: CREDENTIALS });
  expect(sent).toHaveLength(1);
  // the extension id travels with the request, so the page knows where to send
  expect(sent[0].request.extensionId).toBe(REQUEST.extensionId);
  expect(sent[0].credentials).toBe(CREDENTIALS);
  expect(api.pairExtension).toBeTruthy();
});

test('the pair call names the device and the extension', async () => {
  let seen: unknown = null;
  apiWith({
    pairExtension: async (input) => {
      seen = input;
      return CREDENTIALS;
    },
  });
  await runPairFlow(REQUEST, 'alice laptop', async () => ({ ok: true }));
  expect(seen).toEqual({
    device_name: 'alice laptop',
    extension_id: REQUEST.extensionId,
  });
});

test('a server refusal is reported, not thrown at the page', async () => {
  apiWith({
    pairExtension: async () => {
      throw new Error('sign in to continue');
    },
  });
  const outcome = await runPairFlow(REQUEST, 'laptop', async () => ({
    ok: true,
  }));
  expect(outcome).toEqual({ kind: 'refused', message: 'sign in to continue' });
  // nothing was sent: there was nothing to send
  expect(outcome.kind === 'refused').toBe(true);
});

test('an extension that does not answer leaves a token and a warning', async () => {
  apiWith();
  const outcome = await runPairFlow(REQUEST, 'laptop', async () => ({
    ok: false,
    error: 'no receiver',
  }));
  expect(outcome.kind).toBe('unreachable');
  if (outcome.kind === 'unreachable') {
    expect(outcome.reason).toBe('no receiver');
    // the credentials are kept for the caller, but the view never paints them
    expect(outcome.credentials.token).toBe('plain-secret');
  }
});

test('the message carries the token, the base url and the nonce', async () => {
  const sent: { id: string; message: any }[] = [];
  const messaging = {
    runtime: {
      sendMessage: (id: string, message: unknown, callback?: any) => {
        sent.push({ id, message });
        callback?.({ ok: true });
      },
    },
  };
  await sendCredentialsToExtension(
    messaging,
    REQUEST,
    CREDENTIALS,
    'https://tabversed.example',
  );
  expect(sent).toHaveLength(1);
  expect(sent[0].id).toBe(REQUEST.extensionId);
  expect(sent[0].message.type).toBe('tabverse_pair_credentials');
  expect(sent[0].message.nonce).toBe(REQUEST.nonce);
  expect(sent[0].message.credentials.token).toBe('plain-secret');
  expect(sent[0].message.baseUrl).toBe('https://tabversed.example');
});

test('a browser without the messaging API reports no receiver rather than hanging', async () => {
  const outcome = await sendCredentialsToExtension(
    {},
    REQUEST,
    CREDENTIALS,
  ).then((r) => r as any);
  expect(outcome.ok).toBe(false);
});

test('the request survives a sign-in round trip', () => {
  // The stash is what makes the wizard work when the person has to sign in
  // first: both sign-in paths come back to the console root, losing the
  // fragment (server/ui/data/pair.ts, and withConsoleReturn on the server).
  const memory = new Map<string, string>();
  const storage = {
    setItem: (k: string, v: string) => void memory.set(k, v),
    getItem: (k: string) => memory.get(k) ?? null,
    removeItem: (k: string) => void memory.delete(k),
  };

  stashPairRequest(REQUEST, storage);
  // after the round trip the page reads it back, once
  expect(takeStashedPairRequest(storage)).toEqual(REQUEST);
  expect(takeStashedPairRequest(storage)).toBeNull();
});

test('an old stash is ignored rather than resurrecting a pairing', () => {
  const memory = new Map<string, string>();
  const storage = {
    setItem: (k: string, v: string) => void memory.set(k, v),
    getItem: (k: string) => memory.get(k) ?? null,
    removeItem: (k: string) => void memory.delete(k),
  };
  // stamped an hour and a half ago: past the TTL
  memory.set(
    'tabverse_pending_pair',
    JSON.stringify({ request: REQUEST, at: Date.now() - 90 * 60 * 1000 }),
  );
  expect(takeStashedPairRequest(storage)).toBeNull();
});
