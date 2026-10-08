import { beforeEach, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { PairView } from './PairView';
import { setApi, createConsoleApi } from '../data/api';
import { loadMeFx } from '../data/effects';
import { $me } from '../data/stores/session';
import type { DeviceCredentials } from '../data/types';

/**
 * The agree page the extension opens (adr/0020).
 *
 * Static markup, because that is the only component-level check this repo has
 * (adr/0018, and no testing-library per AGENTS.md). What matters here is that
 * the page asks (device name), says what it is about to do, never paints a
 * token, and says plainly when the extension did not answer.
 */

const REQUEST = {
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

function signedIn(signedIn: boolean) {
  return createConsoleApi(async () => ({
    status: 200,
    ok: true,
    text: async () =>
      JSON.stringify({
        signed_in: signedIn,
        csrf_header: 'X-XSRF-Token',
        csrf: 't',
        providers: [],
        admin_email: '',
        require_email_verification: false,
      }),
  }));
}

beforeEach(() => {
  setApi(
    createConsoleApi(async (url) => ({
      status: 200,
      ok: true,
      text: async () =>
        JSON.stringify(
          url.startsWith('/console/api/v1/console/pair') ? CREDENTIALS : {},
        ),
    })),
  );
});

function render(request: typeof REQUEST | null, send?: any): string {
  return renderToStaticMarkup(
    <PairView request={request} sendToExtension={send} />,
  );
}

const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

test('the page asks for a device name and says what will happen', () => {
  const markup = render(REQUEST, async () => ({ ok: true }));
  const said = text(markup);
  expect(said).toContain('Connect Tabverse');
  expect(said).toContain('Device name');
  expect(said).toContain('Allow this device');
  expect(markup).toContain('pair-device-input');
  // it says where the token goes, because "handed straight to the extension"
  // is the whole consent
  expect(said).toMatch(/never shown on this page|handed straight/i);
});

test('no token is ever painted, whatever the state', () => {
  // The credentials exist in the page's memory (it sends them), but nothing
  // renders them: a token in the DOM is a token in a screenshot.
  const markup = render(REQUEST, async () => ({
    ok: false,
    error: 'no receiver',
  }));
  expect(markup).not.toContain('plain-secret');
  expect(markup).not.toContain(CREDENTIALS.token);
});

test('a page the extension did not open says so instead of pretending', () => {
  const said = text(render(null));
  expect(said).toContain('not opened by Tabverse');
});

test('a signed-out person is asked to sign in before anything is minted', async () => {
  // $me drives it: the flow cannot mint a token without a session, and the
  // round trip comes back to the console root, so the request is stashed
  // (data/pair.ts) and this view returns on the way back.
  setApi(signedIn(false));
  // the store is what the view reads, and boot() fills it before anything is
  // drawn; the effect has to settle for the assertion to mean anything
  await loadMeFx();
  const markup = renderToStaticMarkup(<PairView request={REQUEST} />);
  const said = text(markup);
  expect(said).toContain('Sign in to connect Tabverse');
  expect(said).toContain('Sign in'); // the console's own form is shown under it
  expect(markup).not.toContain('Allow this device');
});
