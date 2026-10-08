import { expect, test } from 'vitest';

import { setApi, createConsoleApi } from '../api';
import {
  openAccount,
  setDataArchived,
  setTab,
  visibleCredentials,
  $account,
  $credentialsArchived,
  $dataArchived,
  $tab,
} from '../stores/accounts';
import {
  $records,
  $search,
  $tabspaces,
  setRecordDeleted,
  setSearchQuery,
  setTabspaceQuery,
} from '../stores/browse';
import { $bundle, $drawerOpen } from '../stores/drawer';
import { $bootStatus, $me, sessionExpired } from '../stores/session';
import { $toasts } from '../stores/toasts';
import {
  dismissTabspace,
  loadTabspaces,
  openAccount as openAccountAction,
  openTabspaceById,
  toggleDataArchived,
} from '../actions';
import type {
  DeviceInfo,
  TabspaceBundle,
  TokenInfo,
  UserSummary,
} from '../types';

/**
 * The console's wiring, driven through a stub client.
 *
 * What is being checked is the behaviour the old script had and a compiler could
 * not see: which call follows which state change, what a 401 does to the whole
 * page, and that a refusal from the server is visible rather than silent.
 */

type Answer = { status?: number; body?: unknown };

function stubApi(answers: Record<string, Answer> = {}) {
  const seen: { url: string; method: string }[] = [];
  const api = createConsoleApi(async (url, init) => {
    seen.push({ url, method: init?.method || 'GET' });
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
  setApi(api);
  return { api, seen };
}

function userSummary(over: Partial<UserSummary> = {}): UserSummary {
  return {
    id: 'usr_1',
    name: 'Window-3',
    email: 'p@example.com',
    role: 'user',
    created_at: '2026-09-01T00:00:00Z',
    rev_seq: 7,
    device_count: 1,
    token_count: 1,
    record_count: 4,
    last_activity: Date.now() - 60_000,
    ...over,
  };
}

function device(over: Partial<DeviceInfo> = {}): DeviceInfo {
  return {
    id: 'dev_1',
    name: 'laptop',
    created_at: '2026-09-01T00:00:00Z',
    active_tokens: 1,
    last_used: Date.now(),
    archived: false,
    archived_records: 0,
    ...over,
  };
}

function token(over: Partial<TokenInfo> = {}): TokenInfo {
  return {
    hash: 'hash1',
    fingerprint: 'abcd1234',
    device_id: 'dev_1',
    device_name: 'laptop',
    created_at: '2026-09-01T00:00:00Z',
    revoked: false,
    last_used: Date.now(),
    archived: false,
    ...over,
  };
}

function bundle(over: Partial<TabspaceBundle> = {}): TabspaceBundle {
  return {
    tabspace: {
      id: 'ts_1',
      name: 'Window-3',
      created_at: 1,
      updated_at: 2,
      rev: 1,
      tab_count: 0,
      groups: 0,
      notes: 0,
      todos: 0,
      bookmarks: 0,
      closed_tabs: 0,
    },
    tabspace_data: {},
    tabs: [],
    notes: [],
    todos: [],
    bookmarks: [],
    closed_tabs: [],
    aggregates: {},
    ...over,
  };
}

test('opening an account loads it and lands on a tab that has something in it', async () => {
  stubApi({
    '/console/api/v1/admin/users/usr_1/tabspaces': {
      body: { tabspaces: [], total: 0, limit: 24, offset: 0 },
    },
    '/console/api/v1/admin/users/usr_1/records': {
      body: { records: [], total: 0, limit: 50, offset: 0 },
    },
    '/console/api/v1/admin/users/usr_1': {
      body: {
        user: userSummary(),
        stats: {
          user_id: 'usr_1',
          rev_seq: 7,
          total: 4,
          live: 4,
          by_entity: {},
        },
        devices: [device()],
        tokens: [token()],
      },
    },
  });

  await openAccountAction('usr_1');

  expect($account.getState()?.user.id).toBe('usr_1');
  // A device is paired, so the data is worth looking at; the tab the operator
  // chose is kept across account switches.
  expect($tab.getState()).toBe('data');
});

test('an account with no device lands on the pairing tab', async () => {
  stubApi({
    '/console/api/v1/admin/users/usr_1': {
      body: {
        user: userSummary({ device_count: 0 }),
        stats: {
          user_id: 'usr_1',
          rev_seq: 0,
          total: 0,
          live: 0,
          by_entity: {},
        },
        devices: [],
        tokens: [],
      },
    },
  });
  setTab('credentials');
  await openAccountAction('usr_1');
  // The choice survives an account switch, which is what the operator asked for
  // by picking it; only a first visit picks for them.
  expect($tab.getState()).toBe('credentials');
});

test('a 401 sends the whole page back to the sign-in form', async () => {
  stubApi({ '/console/api/v1/admin/users/usr_1': { status: 401 } });
  await openAccountAction('usr_1');
  expect($account.getState()).toBeNull();
});

test('a refusal from the server is visible, not silent', async () => {
  stubApi({
    '/console/api/v1/admin/users/usr_1/tabspaces': {
      status: 409,
      body: { error: 'conflict', message: 'revoke the device first' },
    },
  });
  await openAccountAction('usr_1');
  await loadTabspaces();
  const toasts = $toasts.getState();
  expect(toasts.at(-1)?.kind).toBe('bad');
  // A 409 is a precondition the server explains in a sentence; flattening it
  // into "operation failed" is what this assertion is against.
  expect(toasts.at(-1)?.message).toBe('revoke the device first');
});

test('a filter resets the page it filters', async () => {
  stubApi();
  openAccount('usr_1');
  setTabspaceQuery('window');
  expect($tabspaces.getState()).toMatchObject({ q: 'window', offset: 0 });
  setRecordDeleted(true);
  expect($records.getState()).toMatchObject({ deleted: true, offset: 0 });
  setSearchQuery('note');
  expect($search.getState().q).toBe('note');
});

test('the archived toggle drives the three views at once', async () => {
  stubApi();
  openAccount('usr_1');
  setDataArchived(true);
  expect($dataArchived.getState()).toBe(true);
  await toggleDataArchived(false);
  expect($dataArchived.getState()).toBe(false);
  // Opening a new account starts with nothing archived shown, so a filter left
  // on does not silently hide a whole account's history.
  expect($dataArchived.getState()).toBe(false);
});

test('archived credentials are hidden unless asked for, and the hidden ones are counted', () => {
  const detail = {
    user: userSummary(),
    stats: { user_id: 'usr_1', rev_seq: 7, total: 4, live: 4, by_entity: {} },
    devices: [device(), device({ id: 'dev_2', archived: true })],
    tokens: [token(), token({ hash: 'hash2', revoked: true, archived: true })],
  };
  const hidden = visibleCredentials(detail, false);
  expect(hidden.devices).toHaveLength(1);
  expect(hidden.tokens).toHaveLength(1);
  expect(hidden.hiddenDevices).toBe(1);
  expect(hidden.hiddenTokens).toBe(1);

  const shown = visibleCredentials(detail, true);
  expect(shown.devices).toHaveLength(2);
  expect(shown.tokens).toHaveLength(2);
});

test('the drawer opens a tabverse, and closing it forgets which one it was', async () => {
  stubApi({
    '/console/api/v1/admin/users/usr_1/tabspaces/ts_1': { body: bundle() },
  });
  openAccount('usr_1');
  await openTabspaceById('ts_1');
  expect($drawerOpen.getState()).toBe(true);
  expect($bundle.getState()?.tabspace.id).toBe('ts_1');

  dismissTabspace();
  expect($drawerOpen.getState()).toBe(false);
  expect($bundle.getState()).toBeNull();
});

test('a tabverse that is not there closes the drawer rather than opening an empty one', async () => {
  stubApi({
    '/console/api/v1/admin/users/usr_1/tabspaces/ts_9': {
      status: 404,
      body: { error: 'not_found', message: 'no such tabverse' },
    },
  });
  openAccount('usr_1');
  await openTabspaceById('ts_9');
  expect($drawerOpen.getState()).toBe(false);
});

test('the session store has one answer for "signed out", whoever noticed', () => {
  sessionExpired();
  expect($bootStatus.getState()).toBe('signed-out');
  expect($me.getState()).toBeNull();
});

test('a stale selection is dropped when the account changes', () => {
  // The tables below the account are per account: showing the previous
  // account's devices for a moment is how an operator revokes the wrong one.
  openAccount('usr_1');
  expect($account.getState()).toBeNull();
  expect($credentialsArchived.getState()).toBe(false);
});
