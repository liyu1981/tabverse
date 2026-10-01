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

/** The first element whose rendered text is exactly `wanted`. */
function findByText(node, wanted) {
  if (!node || typeof node !== 'object') return null;
  if (node.addEventListener && node.textContent === wanted) return node;
  for (const kid of node.children || []) {
    const hit = findByText(kid, wanted);
    if (hit) return hit;
  }
  return null;
}

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
  // ...and the bare ones, which carry no value at all: `hidden` and `checked`
  // are written without one, so the run above cannot see them.
  for (const a of m[2].matchAll(/\s([\w-]+)(?=["\s]|$)/g)) {
    if (!(a[1] in attrs)) attrs[a[1]] = '';
  }
  pageAttrs.set(id, attrs);
}

function makeElement(id) {
  const attrs = pageAttrs.get(id) || {};
  const listeners = {};
  const el = {
    id,
    // a real element: without this the script's own `el()` helper treats
    // anything it is handed as a *text* value, because it decides with
    // `child.nodeType`, and every nested element turns into "[object Object]"
    nodeType: 1,
    // the page's own `hidden` attribute, so a container that starts hidden
    // (the drawer, the operator-only rail item) really does start hidden
    hidden: 'hidden' in attrs,
    value: attrs.value || '',
    checked: 'checked' in attrs,
    _text: '',
    // textContent aggregates descendants, the way the DOM's does - so reading it
    // back finds what a person would see rendered.
    get textContent() {
      if (this.children.length)
        return this.children.map((c) => c.textContent ?? String(c)).join('');
      return this._text;
    },
    set textContent(v) {
      this._text = String(v);
    },
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
      // A real browser turns a string into a text node, so the stub has to as
      // well: anything that reads back a child's text goes through this.
      for (const kid of kids) {
        el.children.push(
          kid && kid.nodeType ? kid : { nodeType: 3, textContent: String(kid) },
        );
      }
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

/**
 * Everything the script built, so a test can reach a row it rendered rather
 * than only the containers the page declares by id.
 */
const created = [];
/** The first element the script created with this class, as the page would show it. */
function createdWithClass(cls) {
  return created.find((e) => String(e.className).split(/\s+/).includes(cls));
}

/** What the script registered on the document itself (Escape, and so on). */
const documentListeners = {};

/** Answers the two calls boot() makes, for a visitor who is not signed in. */
/** Every path the script asked for, in order: which action a button fired. */
let called = [];
/**
 * The same requests with their query string, for the few things that live in a
 * parameter - the delete's typed confirmation, above all.
 */
let requests = [];
/** What the next confirm() answers, so a test can decline a destructive one. */
let confirmAnswer = true;
/** What the next prompt() answers (the delete's typed confirmation). */
let promptAnswer = null;

function stubFetch(routes, problems) {
  return async (url, init) => {
    const path = String(url).split('?')[0];
    called.push((init && init.method) || 'GET', path);
    requests.push({ method: (init && init.method) || 'GET', url: String(url) });
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
  created.length = 0;
  called = [];
  requests = [];
  const problems = [];
  const onRejection = (reason) =>
    problems.push(String((reason && reason.message) || reason));
  process.on('unhandledRejection', onRejection);
  const document = {
    querySelector: (sel) =>
      sel.startsWith('#') ? elementFor(sel) : makeElement(sel),
    // the script listens on the document (Escape closes the drawer), which the
    // stub has to answer like a real one or the script throws on load
    addEventListener(type, fn) {
      if (!documentListeners[type]) documentListeners[type] = [];
      documentListeners[type].push(fn);
    },
    querySelectorAll(sel) {
      if (!sel.startsWith('.')) return [];
      return (byClass.get(sel.slice(1)) || []).map((id) =>
        elementFor('#' + id),
      );
    },
    createElement: (tag) => {
      const node = makeElement('<' + tag + '>');
      created.push(node);
      return node;
    },
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
    confirm: () => {
      const answer = confirmAnswer;
      confirmAnswer = true;
      return answer;
    },
    prompt: () => promptAnswer,
    alert: () => {},
    navigator: {},
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
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

test('a device button says what it does', async () => {
  // The label, the tooltip, the confirmation and the request all derive from one
  // flag. They did not: the label said "Archive" while the call was hardcoded
  // to unarchive, so a live device offered Archive and then asked "bring it
  // back from archive" - which is exactly what a person reported seeing.
  const withRevokedDevice = {
    ...ME_PERSON,
    '/api/v1/admin/users/usr_me': {
      user: { id: 'usr_me', name: 'Yuli', created_at: '2026-01-01T00:00:00Z' },
      stats: { live: 1, total: 1, by_entity: {} },
      // a revoked, not-yet-archived device: the state the report was about
      devices: [{ id: 'dev_x', name: 'chrome test', active_tokens: 0 }],
      tokens: [
        {
          hash: 'h',
          fingerprint: 'abcdef01',
          device_name: 'chrome test',
          revoked: true,
        },
      ],
    },
  };
  expect(await run(withRevokedDevice)).toEqual([]);

  // the devices table is the stub element the rows were appended to
  const button = findByText(elements.get('device-table'), 'Archive');
  expect(button, 'the device row has no Archive button').toBeTruthy();
  expect(button.textContent).toBe('Archive');
  expect(called).not.toContain(
    '/api/v1/admin/users/usr_me/devices/dev_x/archive',
  );

  // clicking a button labelled "Archive" must archive, not unarchive
  confirmAnswer = true;
  await button.fire('click');
  expect(called).toContain('PUT');
  expect(called).toContain('/api/v1/admin/users/usr_me/devices/dev_x/archive');
});

test('archived devices and tokens are hidden until asked for', async () => {
  // Archiving a device used to toast "archived" and leave the row exactly where
  // it was, because neither table had a filter and the token table showed
  // archived rows permanently. Both are the same bug: the tables have to agree
  // with the account they describe (adr/0011).
  const withRetired = {
    ...ME_PERSON,
    '/api/v1/admin/users/usr_me': {
      user: { id: 'usr_me', name: 'Yuli', created_at: '2026-01-01T00:00:00Z' },
      stats: { live: 3, total: 3, by_entity: {} },
      devices: [
        { id: 'dev_1', name: 'laptop', active_tokens: 1 },
        {
          id: 'dev_2',
          name: 'lost phone',
          active_tokens: 0,
          archived: true,
          archived_records: 7,
        },
      ],
      tokens: [
        {
          hash: 'a',
          fingerprint: 'aaaaaaaa',
          device_name: 'laptop',
          revoked: false,
        },
        {
          hash: 'b',
          fingerprint: 'bbbbbbbb',
          device_name: 'lost phone',
          revoked: true,
          archived: true,
        },
      ],
    },
  };

  // Unticked: one device row and one token row, not two and two.
  expect(await run(withRetired)).toEqual([]);
  expect(elements.get('device-table').children.length).toBe(1);
  expect(elements.get('token-table').children.length).toBe(1);
  // the counters agree with the tables rather than with the account
  // ...and the rail's count follows the table rather than the account: one
  // device on screen, not two
  const note = elements.get('rail-note-credentials').textContent;
  expect(note).toContain('1 paired');
  expect(note).not.toContain('2 paired');

  // ...and ticking the box brings the retired rows back, so hiding them is a
  // choice rather than a loss. The box is ticked the way a person does it -
  // after the page has loaded, because opening an account resets the view.
  const box = elements.get('credentials-archived');
  box.checked = true;
  await box.fire('change');
  expect(elements.get('device-table').children.length).toBe(2);
  expect(elements.get('token-table').children.length).toBe(2);
  expect(elements.get('rail-note-credentials').textContent).toContain(
    '2 paired',
  );
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

// ---- the tabverse drawer --------------------------------------------------

const TABVERSE_BUNDLE = {
  tabspace: {
    id: 'ts_1',
    name: 'Window-3',
    created_at: 1700000000000,
    updated_at: 1700000500000,
    rev: 7,
    tab_count: 2,
    groups: 1,
    notes: 1,
    todos: 0,
    bookmarks: 0,
    closed_tabs: 0,
  },
  tabspace_data: {
    tabGroups: [{ id: 'g1', title: 'work', color: 'blue', tabIds: ['t2'] }],
  },
  tabs: [
    {
      id: 't1',
      rev: 3,
      position: 0,
      data: {
        title: 'Alpha',
        url: 'https://a.example/',
        favIconUrl: '',
        pinned: true,
        suspended: false,
      },
    },
    {
      id: 't2',
      rev: 4,
      position: 1,
      data: {
        title: 'Beta',
        url: 'https://b.example/',
        favIconUrl: '',
        pinned: false,
        suspended: false,
      },
    },
  ],
  notes: [],
  todos: [],
  bookmarks: [],
  closed_tabs: [],
  aggregates: {},
};

/** One account with one stored tabverse, and its bundle. */
const WITH_A_TABVERSE = {
  ...ME_PERSON,
  '/api/v1/admin/users/usr_me/tabspaces': {
    tabspaces: [TABVERSE_BUNDLE.tabspace],
    total: 1,
  },
  '/api/v1/admin/users/usr_me/tabspaces/ts_1': TABVERSE_BUNDLE,
};

test('a tabverse is a row, and clicking it opens the drawer over the account', async () => {
  const problems = await run(WITH_A_TABVERSE);
  expect(problems, 'the script raised: ' + problems.join(' | ')).toEqual([]);

  // A list of rows, not a grid of cards: the operator is comparing them.
  const row = createdWithClass('tabverse-row');
  expect(row, 'the tabverse list rendered no row').toBeDefined();
  expect(row.textContent).toContain('Window-3');
  expect(row.textContent).toContain('2 tabs');

  // Nothing is open until a row is clicked.
  expect(elements.get('drawer').hidden).toBe(true);

  await row.fire('click');

  expect(elements.get('drawer').hidden).toBe(false);
  expect(elements.get('drawer-title').textContent).toBe('Window-3');
  // the account view is still behind it, which is the point of a drawer
  expect(elements.get('view-account').hidden).toBe(false);
  // the extension's own line, and its tab cards, minus the action buttons
  const summary = createdWithClass('drawer-summary');
  expect(summary.textContent).toContain('Working on');
  expect(summary.textContent).toContain('2 tabs');
  expect(summary.textContent).toContain('1 group');
  expect(createdWithClass('tab-card')).toBeDefined();
  // the only button in here is the delete
  expect(elements.get('drawer-delete').hidden).toBe(false);
  // and the notes are folded away rather than taking the drawer over
  expect(createdWithClass('drawer-more')).toBeDefined();
});

test('Escape closes the drawer', async () => {
  await run(WITH_A_TABVERSE);
  const row = createdWithClass('tabverse-row');
  await row.fire('click');
  expect(elements.get('drawer').hidden).toBe(false);
  for (const fn of documentListeners.keydown || []) fn({ key: 'Escape' });
  // the panel slides out first, then the drawer is hidden (see DRAWER_EXIT_MS)
  await new Promise((r) => setTimeout(r, 260));
  expect(elements.get('drawer').hidden).toBe(true);
});

test('deleting a tabverse asks for a typed confirmation, then asks the server', async () => {
  await run(WITH_A_TABVERSE);
  const row = createdWithClass('tabverse-row');
  await row.fire('click');

  // The wrong thing typed is not a deletion.
  promptAnswer = 'nope';
  await elements.get('drawer-delete').fire('click');
  expect(requests.some((r) => r.method === 'DELETE')).toBe(false);
  expect(elements.get('drawer').hidden).toBe(false);

  // The right thing typed sends the delete with the id back as the
  // confirmation the server demands.
  promptAnswer = 'Window-3';
  await elements.get('drawer-delete').fire('click');
  const del = requests.find((r) => r.method === 'DELETE');
  expect(del, 'the delete never left the page').toBeDefined();
  expect(del.url).toBe(
    '/api/v1/admin/users/usr_me/tabspaces/ts_1?confirm=ts_1',
  );
  await new Promise((r) => setTimeout(r, 260));
  expect(elements.get('drawer').hidden).toBe(true);
});

test('the delete is not offered while looking through somebody else', async () => {
  const problems = await run({
    ...WITH_A_TABVERSE,
    '/api/v1/console/impersonation': {
      assuming: true,
      as: 'alice',
      user_id: 'usr_alice',
      as_by: 'usr_root',
      read_only: true,
    },
    '/api/v1/admin/users/usr_alice': {
      user: { id: 'usr_alice', name: 'alice' },
      stats: { live: 14, total: 14, by_entity: {} },
      devices: [],
      tokens: [],
    },
    '/api/v1/admin/users/usr_alice/tabspaces': {
      tabspaces: [TABVERSE_BUNDLE.tabspace],
      total: 1,
    },
    '/api/v1/admin/users/usr_alice/tabspaces/ts_1': TABVERSE_BUNDLE,
    '/api/v1/admin/users/usr_alice/records': { records: [], total: 0 },
    '/api/v1/admin/users/usr_alice/search': { hits: [] },
  });
  expect(problems, 'the script raised: ' + problems.join(' | ')).toEqual([]);
  const row = createdWithClass('tabverse-row');
  await row.fire('click');
  // the server would refuse it with 403 anyway (adr/0014), so it is not shown
  expect(elements.get('drawer-delete').hidden).toBe(true);
});

test('a tabverse that was deleted under the console does not open an empty drawer', async () => {
  const problems = await run({
    ...WITH_A_TABVERSE,
    // the bundle is gone: somebody deleted it, or this tabverse id is not ours
    '/api/v1/admin/users/usr_me/tabspaces/ts_1': { error: 'not found' },
  });
  expect(problems, 'the script raised: ' + problems.join(' | ')).toEqual([]);
  const row = createdWithClass('tabverse-row');
  await row.fire('click');
  expect(elements.get('drawer').hidden).toBe(true);
  expect(elements.get('toast').hidden).toBe(false);
});

// ---- deleting an account --------------------------------------------------

test('the account header deletes with the confirmation the server demands', async () => {
  // The header's Delete button used to be its own copy of this flow and forgot
  // the `?confirm=`, so the server answered `confirmation_required` and the
  // button did nothing at all. Typed name in, DELETE with the id back out.
  await run(ME_PERSON);
  promptAnswer = 'nope';
  await elements.get('delete-user').fire('click');
  expect(
    requests.some((r) => r.method === 'DELETE'),
    'the wrong name deleted the account',
  ).toBe(false);

  promptAnswer = 'Yuli';
  await elements.get('delete-user').fire('click');
  const del = requests.find((r) => r.method === 'DELETE');
  expect(del, 'the delete never left the page').toBeDefined();
  expect(del.url).toBe('/api/v1/admin/users/usr_me?confirm=usr_me');
  // ...and the account was the signed-in person's, so the console is empty now
  expect(elements.get('app').hidden).toBe(true);
  expect(elements.get('view-signin').hidden).toBe(false);
});

test('a directory row deletes with the same confirmation', async () => {
  await run(ME_OPERATOR);
  promptAnswer = 'alice';
  await createdWithClass('danger').fire('click');
  const del = requests.find((r) => r.method === 'DELETE');
  expect(del, 'the delete never left the page').toBeDefined();
  expect(del.url).toBe('/api/v1/admin/users/usr_alice?confirm=usr_alice');
});
