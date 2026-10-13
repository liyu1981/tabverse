import { beforeEach, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { RegisterView } from './RegisterView';
import { setApi, createConsoleApi } from '../data/api';
import { loadMeFx } from '../data/effects';
import { sessionExpired } from '../data/stores/session';

/**
 * The register page, rendered to markup (adr/0029). It is the second half of a
 * sign-in now, so what matters is that it asks for the two things the old
 * combined flow never did - a required address and the agreement - and that it
 * offers the invitation code an invite-only server needs.
 */

function say(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function pendingRegistration(me: Record<string, unknown>) {
  setApi(
    createConsoleApi(async () => ({
      status: 200,
      ok: true,
      text: async () =>
        JSON.stringify({
          signed_in: false,
          csrf_header: 'X-XSRF-Token',
          csrf: 'csrf-token',
          providers: ['google'],
          docs: true,
          needs_registration: true,
          registration: {
            provider: 'google',
            email: 'yli@example.com',
            name: 'Yu Li',
          },
          ...me,
        }),
    })),
  );
  await loadMeFx();
}

beforeEach(() => {
  sessionExpired();
});

test('a provider login with no account asks for an address and the agreement', async () => {
  await pendingRegistration({});
  const html = renderToStaticMarkup(<RegisterView />);
  expect(say(html)).toContain('Create your account');
  expect(say(html)).toContain('You signed in with Google');
  // The address comes from the provider but is still the person's to confirm,
  // and is required.
  expect(html).toContain('value="yli@example.com"');
  // The agreement is the second thing the one-step flow never asked for.
  expect(say(html)).toContain('user agreement');
  expect(html).toContain('href="/terms"');
  expect(say(html)).toContain('Create account');
});

test('an invite-only server requires the code, and offers to request one', async () => {
  await pendingRegistration({
    invite_required: true,
    admin_email: 'operator@example.com',
  });
  const html = renderToStaticMarkup(<RegisterView />);
  expect(say(html)).toContain('Invitation code (required)');
  expect(say(html)).toContain('request an invitation');
});

test('the operator address is exempt from the invitation code', async () => {
  await pendingRegistration({
    invite_required: true,
    admin_email: 'yli@example.com',
  });
  const html = renderToStaticMarkup(<RegisterView />);
  expect(say(html)).toContain('Invitation code (only if you were given one)');
  expect(say(html)).not.toContain('request an invitation');
});

test('a provider with no address leaves the email empty', async () => {
  await pendingRegistration({
    registration: { provider: 'github', email: '', name: 'yli' },
  });
  const html = renderToStaticMarkup(<RegisterView />);
  expect(say(html)).toContain('You signed in with GitHub');
  expect(html).toContain('placeholder="you@example.com"');
  expect(html).not.toContain('value="yli@example.com"');
});

test('without the embedded docs the agreement falls back to the repository', async () => {
  await pendingRegistration({ docs: false });
  const html = renderToStaticMarkup(<RegisterView />);
  expect(html).toContain('github.com/liyu1981/tabverse');
  expect(html).not.toContain('href="/terms"');
});
