import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

/**
 * The console's script is served as-is: no bundler, no type checker, no
 * framework between it and the page. A `node --check` only proves it parses, so
 * a *missing function* - the kind of thing a refactor drops silently - sails
 * through every other check and then blanks the page at runtime, because the
 * first line of boot() throws and nothing is ever un-hidden.
 *
 * So this runs the real script against a stub DOM built from the real page, and
 * two things are asserted: it does not throw, and it reaches the sign-in view
 * for a visitor who is not signed in. The stub only hands back elements for ids
 * that exist in index.html, so a selector with no element behind it fails here
 * too.
 */

const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const html = readFileSync(here('index.html'), 'utf8');
const script = readFileSync(here('console.js'), 'utf8');

const pageIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

// The page's own classes, so `querySelectorAll('.tab-panel')` returns the real
// panels rather than nothing: the script shows and hides them by class, and a
// stub that answered `[]` would leave the whole tab mechanism unverified.
const byClass = new Map();
for (const m of html.matchAll(
  /<(\w+)[^>]*class="([^"]+)"[^>]*id="([^"]+)"|<(\w+)[^>]*id="([^"]+)"[^>]*class="([^"]+)"/g,
)) {
  const cls = (m[2] || m[6] || '').split(/\s+/);
  const id = m[3] || m[5];
  for (const c of cls) {
    if (!c) continue;
    if (!byClass.has(c)) byClass.set(c, []);
    byClass.get(c).push(id);
  }
}

/** The elements the script found, so a test can look at what it did. */
const elements = new Map();

// Every attribute the page declares for an id, so `dataset.panel` and friends
// are the values the real element would have. The script switches panels by
// `panel.dataset.panel`, and a stub with an empty dataset hides everything.
const pageAttrs = new Map();
// bare attributes (`hidden`, `checked`) carry no value, so the attribute run has
// to allow them - otherwise every multi-line tag in the page is skipped entirely
for (const m of html.matchAll(/<(\w+)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*>/g)) {
  const id = (m[2].match(/\sid="([^"]+)"/) || [])[1];
  if (!id) continue;
  const attrs = {};
  for (const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
  pageAttrs.set(id, attrs);
}

function makeElement(id) {
  const attrs = pageAttrs.get(id) || {};
  const listeners = {};
  const el = {
    id,
    hidden: false,
    value: attrs.value || '',
    checked: 'checked' in attrs,
    textContent: '',
    innerHTML: '',
    className: attrs.class || '',
    disabled: 'disabled' in attrs,
    dataset: Object.fromEntries(
      Object.entries(attrs)
        .filter(([k]) => k.startsWith('data-'))
        .map(([k, v]) => [k.slice(5), v]),
    ),
    children: [],
    classList: {
      _set: new Set(),
      add(...c) {
        for (const x of c) this._set.add(x);
      },
      remove(...c) {
        for (const x of c) this._set.delete(x);
      },
      toggle(c, on) {
        if (on === undefined) on = !this._set.has(c);
        if (on) this._set.add(c);
        else this._set.delete(c);
        return on;
      },
      contains(c) {
        return this._set.has(c);
      },
    },
    addEventListener(type, fn) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    },
    removeEventListener() {},
    setAttribute(name, value) {
      attrs[name] = value;
    },
    getAttribute(name) {
      return name in attrs ? attrs[name] : null;
    },
    remove() {},
    removeChild(child) {
      el.children = el.children.filter((c) => c !== child);
    },
    focus() {},
    append(...kids) {
      el.children.push(...kids);
    },
    get firstChild() {
      return el.children[0] ?? null;
    },
    querySelector() {
      // A descendant selector ("#user-list button") returns a fresh child.
      return makeElement(id + '>child');
    },
    /** test helper: fire the handlers registered for an event */
    async fire(type) {
      for (const fn of listeners[type] || []) await fn({ preventDefault() {} });
    },
  };
  return el;
}

function elementFor(selector) {
  const id = selector.replace(/^#/, '').split(' ')[0];
  if (!pageIds.has(id)) return null; // a selector with nothing behind it
  if (!elements.has(id)) elements.set(id, makeElement(id));
  return elements.get(id);
}

/** Answers the two calls boot() makes, for a visitor who is not signed in. */
function stubFetch(routes, problems) {
  return async (url) => {
    const path = String(url).split('?')[0];
    if (!(path in routes) && problems) {
      problems.push('unstubbed route: ' + path);
    }
    const body = routes[path] ?? { error: 'not stubbed' };
    return {
      ok: !body.error,
      status: body.error ? 404 : 200,
      async text() {
        return JSON.stringify(body);
      },
    };
  };
}

/**
 * Runs the script and collects everything that went wrong, including the async
 * failures a bare `await run()` would miss: a ReferenceError thrown three
 * awaits deep inside boot() rejects a promise nobody is holding, and the test
 * would pass while the page quietly does nothing.
 */
async function run(routes) {
  elements.clear();
  const problems = [];
  const onRejection = (reason) =>
    problems.push(String((reason && reason.message) || reason));
  process.on('unhandledRejection', onRejection);
  const document = {
    querySelector: (sel) =>
      sel.startsWith('#') ? elementFor(sel) : makeElement(sel),
    querySelectorAll(sel) {
      if (!sel.startsWith('.')) return [];
      return (byClass.get(sel.slice(1)) || []).map((id) =>
        elementFor('#' + id),
      );
    },
    createElement: (tag) => makeElement('<' + tag + '>'),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
    body: makeElement('body'),
  };
  const location = {
    hash: '',
    origin: 'http://127.0.0.1:8223',
    pathname: '/',
    search: '',
    reload() {},
  };
  const sandbox = {
    document,
    location,
    history: { replaceState() {} },
    localStorage: {
      _s: new Map(),
      getItem(k) {
        return this._s.has(k) ? this._s.get(k) : null;
      },
      setItem(k, v) {
        this._s.set(k, String(v));
      },
      removeItem(k) {
        this._s.delete(k);
      },
    },
    fetch: stubFetch(routes, problems),
    confirm: () => true,
    alert: () => {},
    navigator: {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URLSearchParams,
    Blob,
    FormData,
    console,
  };
  const names = Object.keys(sandbox);
  const run_ = new Function(...names, script);
  run_(...names.map((n) => sandbox[n]));
  // let boot()'s awaits settle, and give any unhandled rejection a tick to land
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 10));
  process.off('unhandledRejection', onRejection);
  return problems;
}

// A signed-in *person*: no operator role, so the account view and nothing else.
const ME_PERSON = {
  '/api/v1/admin/config': {
    accounts_enabled: true,
    providers: [],
    version: 'test',
  },
  '/api/v1/console/me': {
    signed_in: true,
    user_id: 'usr_me',
    name: 'Yuli',
    email: 'yuli@example.com',
    role: 'user',
    csrf: 'x',
    csrf_header: 'X-XSRF-Token',
    providers: [],
    admin_email: 'root@example.com',
    operator_exists: true,
    stats: { live: 3, total: 3, by_entity: { tabspace: 3 } },
    // one paired device, so the account opens on Stored data rather than on the
    // Pair Code tab an empty account would land on
    devices: [{ id: 'dev_1', name: 'laptop' }],
  },
  '/api/v1/console/impersonation': { assuming: false },
  '/api/v1/admin/users/usr_me': {
    user: { id: 'usr_me', name: 'Yuli', created_at: '2026-01-01T00:00:00Z' },
    stats: { live: 3, total: 3, by_entity: {} },
    // the account *detail* is what decides the opening tab, so the device has
    // to be here and not only on /console/me
    devices: [{ id: 'dev_1', name: 'laptop' }],
    tokens: [{ hash: 'abc', fingerprint: 'abcdef01', device_name: 'laptop' }],
  },
  '/api/v1/admin/users/usr_me/tabspaces': { tabspaces: [], total: 0 },
  '/api/v1/admin/users/usr_me/records': { records: [], total: 0 },
  '/api/v1/admin/users/usr_me/search': { hits: [] },
};

// A signed-in *operator* with nobody being looked at: the directory.
const ME_OPERATOR = {
  ...ME_PERSON,
  '/api/v1/console/me': {
    ...ME_PERSON['/api/v1/console/me'],
    user_id: 'usr_root',
    name: 'Root',
    email: 'root@example.com',
    role: 'admin',
  },
  // the operator's own account detail: with the Admin tab beside the account
  // tabs, an operator lands on their own data like everybody else
  '/api/v1/admin/users/usr_root': {
    user: { id: 'usr_root', name: 'Root', created_at: '2026-01-01T00:00:00Z' },
    stats: { live: 5, total: 5, by_entity: {} },
    devices: [{ id: 'dev_9', name: 'laptop' }],
    tokens: [{ hash: 'x', fingerprint: 'abcdef01', device_name: 'laptop' }],
  },
  '/api/v1/admin/users/usr_root/tabspaces': { tabspaces: [], total: 0 },
  '/api/v1/admin/users/usr_root/records': { records: [], total: 0 },
  '/api/v1/admin/totals': {
    users: 2,
    devices: 3,
    active_tokens: 3,
    live_records: 14,
    tombstones: 0,
    by_entity: { tabspace: 12 },
  },
  '/api/v1/admin/users': {
    users: [
      {
        id: 'usr_alice',
        name: 'alice',
        email: 'alice@example.com',
        role: 'user',
        device_count: 2,
        record_count: 14,
        last_activity: 1750000000000,
      },
      {
        id: 'usr_root',
        name: 'Root',
        email: 'root@example.com',
        role: 'admin',
        device_count: 1,
        record_count: 0,
        last_activity: 0,
      },
    ],
  },
};

const ME_SIGNED_OUT = {
  '/api/v1/console/me': {
    signed_in: false,
    providers: [],
    admin_email: 'you@example.com',
    operator_exists: false,
    csrf_header: 'X-XSRF-Token',
  },
  '/api/v1/admin/config': {
    accounts_enabled: true,
    providers: [],
    version: 'test',
  },
};

test('the console script runs, and every selector it uses exists in the page', async () => {
  // A missing function or a selector with no element behind it lands here,
  // which is exactly the blank page this guards against.
  const problems = await run(ME_SIGNED_OUT);
  expect(problems, 'the script raised: ' + problems.join(' | ')).toEqual([]);
});

test('a visitor who is not signed in is shown the sign-in form', async () => {
  expect(await run(ME_SIGNED_OUT)).toEqual([]);
  const view = elements.get('view-signin');
  expect(view, 'the script never touched #view-signin').toBeDefined();
  expect(view.hidden, 'the sign-in view is still hidden').toBe(false);
  // ...and the app shell, which holds the data, stays out of the way.
  expect(elements.get('app').hidden).toBe(true);
});

test('a person lands in their own account, with the tabs and no directory', async () => {
  const problems = await run(ME_PERSON);
  expect(problems, 'the script raised: ' + problems.join(' | ')).toEqual([]);
  expect(elements.get('view-signin').hidden).toBe(true);
  expect(elements.get('app').hidden).toBe(false);
  // their account, the tab rail, and nothing about other accounts
  expect(elements.get('view-account').hidden).toBe(false);
  expect(elements.get('panel-data').hidden).toBe(false);
  // the operator-only affordance stays out of reach
  expect(elements.get('rail-admin').hidden).toBe(true);
  // and the owner actions are offered, because these are their own
  expect(elements.get('rename-user').hidden).toBe(false);
  expect(elements.get('delete-user').hidden).toBe(false);
});

test('an account with no devices opens on Pair Code, not on an empty data view', async () => {
  // A brand new account has nothing to browse, so the first tab it shows is the
  // one where a device gets added.
  const noDevice = {
    ...ME_PERSON,
    '/api/v1/console/me': { ...ME_PERSON['/api/v1/console/me'], devices: [] },
    '/api/v1/admin/users/usr_me': {
      ...ME_PERSON['/api/v1/admin/users/usr_me'],
      devices: [],
      tokens: [],
    },
  };
  expect(await run(noDevice)).toEqual([]);
  expect(elements.get('panel-pair').hidden).toBe(false);
  expect(elements.get('panel-data').hidden).toBe(true);
});

test('an operator gets their own account, plus a fourth tab for the accounts', async () => {
  // The three account tabs are where they were for everybody; the operator's
  // powers are one tab beside them, not a different application (ADR 0014).
  const problems = await run(ME_OPERATOR);
  expect(problems, 'the script raised: ' + problems.join(' | ')).toEqual([]);
  expect(elements.get('view-account').hidden).toBe(false);
  // the Admin tab is offered to an operator...
  expect(elements.get('rail-admin').hidden).toBe(false);
  // ...and the three account tabs are already theirs, no directory in the way
  expect(elements.get('panel-data').hidden).toBe(false);
  expect(elements.get('account-name').textContent).not.toContain(
    'impersonated',
  );
  // there is no create-account control anywhere: registration is the only way
  // an account comes into existence
  expect(pageIds.has('create-user-form')).toBe(false);
  expect(pageIds.has('new-user-name')).toBe(false);
});

test('a person does not get the Admin tab', async () => {
  await run(ME_PERSON);
  expect(elements.get('rail-admin').hidden).toBe(true);
});

test('an operator looking at somebody sees that account, titled as such', async () => {
  const problems = await run({
    ...ME_OPERATOR,
    '/api/v1/console/impersonation': {
      assuming: true,
      as: 'alice',
      user_id: 'usr_alice',
      as_by: 'usr_root',
      read_only: true,
    },
    // the account being looked at, with its own data
    '/api/v1/admin/users/usr_alice': {
      user: {
        id: 'usr_alice',
        name: 'alice',
        created_at: '2026-01-01T00:00:00Z',
      },
      stats: { live: 14, total: 14, by_entity: {} },
      devices: [],
      tokens: [],
    },
    '/api/v1/admin/users/usr_alice/tabspaces': { tabspaces: [], total: 0 },
    '/api/v1/admin/users/usr_alice/records': { records: [], total: 0 },
    '/api/v1/admin/users/usr_alice/search': { hits: [] },
  });
  expect(problems, 'the script raised: ' + problems.join(' | ')).toEqual([]);
  // the account view, not the directory: the tab rail belongs to the account
  expect(elements.get('view-account').hidden).toBe(false);
  // the read only banner, and the title says so too
  expect(elements.get('assume-bar').hidden).toBe(false);
  expect(elements.get('account-name').textContent).toContain(
    'impersonated by admin',
  );
  // ...and the owner-only actions are not offered while looking through
  expect(elements.get('rename-user').hidden).toBe(true);
  expect(elements.get('delete-user').hidden).toBe(true);
  // the Admin tab stays available, so another account is one click away
  expect(elements.get('rail-admin').hidden).toBe(false);
});
