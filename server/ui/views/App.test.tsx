import { beforeEach, expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { App } from '../App';
import { boot, openAccount as openAccountAction } from '../data/actions';
import { setApi, createConsoleApi } from '../data/api';
import { sessionExpired } from '../data/stores/session';
import { setTab, $account } from '../data/stores/accounts';
import { loadMeFx } from '../data/effects';
import { AccountView } from './AccountView';

/**
 * The blank-page guard.
 *
 * The hand written console had eighteen tests whose real job was this one: a
 * refactor that dropped a function blanked the page, and nothing else in the
 * build noticed. A compiler catches the missing function now; what is left to
 * check is that the assembled app reaches a *view* from each state it can be in,
 * which is what these render.
 */

/**
 * A stub whose answers are per path, so an account detail is an account detail
 * and not whatever the identity document was (which is how a too-eager stub
 * produced an account view with no account in it).
 */
function stubApi(me: unknown, rest: Record<string, unknown> = {}) {
  const api = createConsoleApi(async (url) => {
    const key = Object.keys(rest).find((path) => url.startsWith(path));
    const body = key ? rest[key] : key === undefined ? me : rest[key as string];
    return {
      status: 200,
      ok: true,
      text: async () => JSON.stringify(body),
    };
  });
  setApi(api);
}

beforeEach(() => {
  sessionExpired();
  // The routing reads window.location and writes window.history, so the tests
  // that boot the console get the same globals a browser hands it. It is the
  // only thing stubbed here: everything below the page is the real app.
  vi.stubGlobal('window', {
    location: {
      hash: '',
      pathname: '/console',
      search: '',
      origin: 'http://console',
    },
    history: { replaceState: () => undefined },
  });
});

test('a visitor who is not signed in gets the sign-in form', () => {
  stubApi({ signed_in: false, csrf_header: 'X-Csrf-Token', providers: [] });
  const html = renderToStaticMarkup(<App />);
  expect(html).toContain('tabversed');
  expect(html).toContain('Send sign-in link');
  expect(html).not.toContain('Pair Code');
});

test('a signed-in person gets the account view, not the form', async () => {
  stubApi(
    {
      signed_in: true,
      user_id: 'usr_1',
      name: 'Person',
      role: 'user',
      csrf_header: 'X-Csrf-Token',
      csrf: 'tok',
      providers: [],
    },
    {
      '/api/v1/admin/users/usr_1/tabspaces': {
        tabspaces: [],
        total: 0,
        limit: 24,
        offset: 0,
      },
      '/api/v1/admin/users/usr_1/records': {
        records: [],
        total: 0,
        limit: 50,
        offset: 0,
      },
      '/api/v1/admin/users/usr_1': {
        user: {
          id: 'usr_1',
          name: 'Person',
          email: 'p@example.com',
          role: 'user',
          created_at: '2026-09-01T00:00:00Z',
          rev_seq: 1,
          device_count: 0,
          token_count: 0,
          record_count: 0,
          last_activity: 0,
        },
        stats: {
          user_id: 'usr_1',
          rev_seq: 1,
          total: 0,
          live: 0,
          by_entity: {},
        },
        devices: [],
        tokens: [],
      },
    },
  );
  await boot();
  const html = renderToStaticMarkup(<App />);
  // The store is what the view reads, so this is the state boot left behind:
  // a signed-in person is in their own account, and the sign-in form is gone.
  expect($account.getState()?.user.id).toBe('usr_1');
  expect(html).toContain('Pair Code');
  expect(html).not.toContain('Send sign-in link');
});

test('the rail carries the account`s four tabs, with the admin one for an operator', async () => {
  await seedAccount('usr_1', 'admin');
  const html = renderToStaticMarkup(<AccountView />);
  expect(html).toContain('Pair Code');
  expect(html).toContain('Devices &amp; Tokens');
  expect(html).toContain('Stored data');
  expect(html).toContain('Admin');
});

test('the admin tab is not offered to a person', async () => {
  await seedAccount('usr_2', 'user');
  const html = renderToStaticMarkup(<AccountView />);
  expect(html).toContain('Stored data');
  expect(html).not.toContain('>Admin<');
});

test('an account document that is not an account does not take the page down', async () => {
  // This view reads four fields deep, and a document written by an older client
  // (or a cut-short reload) can be missing all of them. A crash here is the
  // least informative thing the console could do; what has to hold is that the
  // page still renders and invents nothing about the account.
  stubApi(
    { signed_in: true, providers: [] },
    {
      '/api/v1/admin/users/usr_3': { nothing: true },
    },
  );
  await openAccountAction('usr_3');
  const html = renderToStaticMarkup(<AccountView />);
  expect(html).toContain('Account sections');
  expect(html).not.toContain('undefined');
});

/**
 * Puts one account on screen through the action that does it in the app.
 *
 * The role goes on *both* documents on purpose: the console's own identity
 * decides whether the operator powers are offered, and the account's role says
 * whether the row in the directory is an operator - two different questions that
 * happen to agree in these cases (adr/0014).
 */
async function seedAccount(id: string, role: 'admin' | 'user'): Promise<void> {
  stubApi(
    { signed_in: true, providers: [] },
    {
      '/api/v1/console/me': {
        signed_in: true,
        user_id: id,
        name: 'Person',
        role,
        csrf_header: 'X-Csrf-Token',
        csrf: 'tok',
        providers: [],
      },
      '/api/v1/console/impersonation': { assuming: false },
      [`/api/v1/admin/users/${id}/tabspaces`]: {
        tabspaces: [],
        total: 0,
        limit: 24,
        offset: 0,
      },
      [`/api/v1/admin/users/${id}/records`]: {
        records: [],
        total: 0,
        limit: 50,
        offset: 0,
      },
      [`/api/v1/admin/users/${id}`]: {
        user: {
          id,
          name: 'Window-3',
          email: 'p@example.com',
          role,
          created_at: '2026-09-01T00:00:00Z',
          rev_seq: 3,
          device_count: 1,
          token_count: 1,
          record_count: 2,
          last_activity: Date.now(),
        },
        stats: { user_id: id, rev_seq: 3, total: 2, live: 2, by_entity: {} },
        devices: [],
        tokens: [],
      },
    },
  );
  await loadMeFx();
  await openAccountAction(id);
  setTab('data');
}
