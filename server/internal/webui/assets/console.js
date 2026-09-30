/* tabversed console.
 *
 * Read only over user data by design (adr/0009): the console renders what the
 * server stores, but editing records from here would fight the LWW sync
 * protocol, whose whole point is that the extension's copy wins. What the
 * console *does* change is operator state: accounts, devices, tokens.
 *
 * Plain ES2019, no dependencies, no build step: the Go binary embeds this file
 * next to index.html and serves both.
 */

const TOKEN_KEY = 'tabversed.admin.token';

// The URL fragment carries the console's state: `token=`, `user=`,
// `view=`, `tabspace=` and `q=`, e.g.
//
//   http://host:8223/#token=SECRET&user=usr_123&tabspace=ts_456
//
// so an operator can paste a link from a terminal and bookmark an account. The
// token is moved into localStorage and stripped from the fragment immediately
// (fragments are never sent to a server and never reach a Referer header, so
// it does not linger in history or in a copied URL); the routing parameters
// stay, because they are not secret.
function readHash() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const token = params.get('token');
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    params.delete('token');
    const rest = params.toString();
    history.replaceState(
      null,
      '',
      location.pathname + location.search + (rest ? '#' + rest : ''),
    );
  }
  return params;
}

function writeHash(patch) {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  for (const [k, v] of Object.entries(patch)) {
    if (v) params.set(k, v);
    else params.delete(k);
  }
  const rest = params.toString();
  history.replaceState(
    null,
    '',
    location.pathname + location.search + (rest ? '#' + rest : ''),
  );
}

// Two credentials, and the page has to know which one it is holding (adr/0012):
//
//   - a session cookie, when accounts are on: the XSRF token comes out of a
//     readable cookie and has to be echoed in a header, or the request is refused
//   - the admin token in localStorage, the break-glass path for a deployment
//     with no accounts
//
// Same-origin requests carry the cookie automatically, which is why
// credentials is not set: 'include' would break a plain http deployment.
const api = {
  async call(method, path, body) {
    const headers = {};
    if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (state.csrfHeader && method !== 'GET' && method !== 'HEAD') {
      headers[state.csrfHeader] = state.csrf;
    }
    const res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return null;
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('bad response: ' + text.slice(0, 200));
      }
    }
    if (!res.ok) {
      const err = new Error((data && data.message) || 'HTTP ' + res.status);
      err.status = res.status;
      err.code = data && data.error;
      throw err;
    }
    return data;
  },
  get: (p) => api.call('GET', p),
  post: (p, b) => api.call('POST', p, b === undefined ? {} : b),
  del: (p) => api.call('DELETE', p),
  put: (p, b) => api.call('PUT', p, b),
};

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  users: [],
  selected: null, // user summary
  detail: null, // { user, stats, devices, tokens }
  dataView: 'tabverses',
  tabspaces: {
    items: [],
    total: 0,
    offset: 0,
    limit: 24,
    q: '',
    archived: false,
  },
  records: {
    items: [],
    total: 0,
    offset: 0,
    limit: 50,
    q: '',
    entity: '',
    deleted: false,
    archived: false,
  },
  openTabspace: null, // bundle
  // which of the account's three tabs is open: 'pair' | 'credentials' | 'data'.
  // null until an account is opened, so the first visit can pick a sensible one.
  tab: null,
  // the signed-in account, from /api/v1/console/me
  me: null,
  // the XSRF echo token and the header it goes in
  csrf: '',
  csrfHeader: '',
};

// ---- copy to clipboard ----------------------------------------------------

/**
 * Copy text, reporting whether it worked.
 *
 * The obvious `navigator.clipboard.writeText` is the *only* mechanism in a
 * secure context, and a secure context is exactly what a self-hosted server on
 * a LAN does not have: the console is routinely opened at
 * http://192.168.0.221:8223, where `navigator.clipboard` is undefined and
 * `isSecureContext` is false. So this tries the modern API, falls back to
 * `execCommand('copy')` on a throwaway textarea, and says no if even that is
 * refused - a copy button that silently does nothing is worse than no button.
 */
async function copyText(text) {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path (permission denied, document not focused)
  }
  try {
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('readonly', '');
    scratch.style.position = 'fixed';
    scratch.style.top = '-1000px';
    scratch.style.opacity = '0';
    document.body.appendChild(scratch);
    scratch.select();
    scratch.setSelectionRange(0, text.length);
    const copied = document.execCommand('copy');
    document.body.removeChild(scratch);
    if (copied) return true;
  } catch {
    // fall through to the caller's own fallback
  }
  return false;
}

/**
 * A button that copies `text` and says so. `onFailure` runs when copying was
 * refused, so the caller can select the text and tell the user to press Ctrl+C.
 */
function copyButton(text, label, onFailure) {
  const button = el(
    'button',
    { class: 'copy', type: 'button', title: label },
    label,
  );
  let restoring = null;
  button.addEventListener('click', async () => {
    if (await copyText(text)) {
      button.textContent = 'Copied';
      button.classList.add('done');
      clearTimeout(restoring);
      restoring = setTimeout(() => {
        button.textContent = label;
        button.classList.remove('done');
      }, 1600);
      return;
    }
    if (onFailure) onFailure();
    toast('Copying was blocked — the text is selected, press Ctrl+C', 'bad');
  });
  return button;
}

// ---- tiny helpers ---------------------------------------------------------

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(
      child.nodeType ? child : document.createTextNode(String(child)),
    );
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function ago(ms) {
  if (!ms) return 'never';
  const secs = Math.max(0, (Date.now() - ms) / 1000);
  if (secs < 60) return Math.round(secs) + 's ago';
  if (secs < 3600) return Math.round(secs / 60) + 'm ago';
  if (secs < 86400) return Math.round(secs / 3600) + 'h ago';
  return Math.round(secs / 86400) + 'd ago';
}

function dateOf(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleString() + ' (' + ago(ms) + ')';
}

function bytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KiB';
  return (n / 1048576).toFixed(1) + ' MiB';
}

function jsonSize(value) {
  return new Blob([JSON.stringify(value)]).size;
}

let toastTimer = null;
function toast(message, kind) {
  const node = $('#toast');
  node.textContent = message;
  node.className = 'toast' + (kind ? ' ' + kind : '');
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 4000);
}

function banner(message) {
  const node = $('#banner');
  if (!message) {
    node.hidden = true;
    node.textContent = '';
    return;
  }
  node.textContent = message;
  node.hidden = false;
}

// whoAmI asks the server who the caller is. It answers for all three states -
// signed in, signed out, accounts disabled - so the page never has to guess.
async function whoAmI() {
  try {
    return await api.get('/api/v1/console/me');
  } catch (e) {
    if (e.status === 401) {
      return null;
    }
    // A deployment too old to have the endpoint falls back to the token flow.
    return { accounts_enabled: false, signed_in: false, admin_token: true };
  }
}

function showSignIn(me) {
  $('#view-login').hidden = true;
  $('#view-signin').hidden = false;
  $('#app').hidden = true;
  $('#login-hint').textContent =
    'This server has accounts enabled, so people sign in with a link sent to ' +
    'their email address.';
  const adminLink = $('#signin-admin');
  if (me.admin_token) {
    adminLink.hidden = false;
  }
  renderSignInProviders(me.providers || []);
  const note = $('#signin-note');
  note.textContent = me.self_hosted
    ? 'The link comes from the server, so check your spam folder.'
    : 'No mail server is configured, so the server prints the link in its own log.';
  $('#signin-email').focus();
}

// renderSignInProviders draws one button per configured provider, pointing at
// the library's own login start for that provider.
function renderSignInProviders(providers) {
  const box = $('#signin-providers');
  clear(box);
  if (!providers || !providers.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.append(el('span', { class: 'muted small' }, 'or continue with'));
  for (const name of providers) {
    box.append(
      el(
        'a',
        { class: 'provider', href: '/auth/' + name },
        name === 'github' ? 'GitHub' : name === 'google' ? 'Google' : name,
      ),
    );
  }
}

$('#signin-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const email = $('#signin-email').value.trim();
  if (!email) return;
  const err = $('#signin-error');
  err.hidden = true;
  const button = $('#signin-form button[type=submit]');
  button.disabled = true;
  try {
    // The library owns the form and the send; posting to its endpoint is the
    // whole integration.
    const res = await fetch('/auth/tabverse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ user: email }).toString(),
    });
    if (!res.ok && res.status !== 200) {
      throw new Error('HTTP ' + res.status);
    }
    $('#signin-error').hidden = false;
    $('#signin-error').className = 'muted small';
    $('#signin-error').textContent =
      'Check your email for the sign-in link. It works once and expires.';
    $('#signin-email').value = '';
  } catch (e) {
    err.hidden = false;
    err.className = 'error';
    err.textContent = 'Could not send the link: ' + e.message;
  } finally {
    button.disabled = false;
  }
});

$('#signin-admin').addEventListener('click', (ev) => {
  ev.preventDefault();
  showLogin();
});

$('#sign-out').addEventListener('click', async () => {
  try {
    await api.post('/api/v1/console/signout');
  } catch {
    // Even if the call fails, drop what this page holds.
  }
  state.me = null;
  state.csrf = '';
  state.token = '';
  localStorage.removeItem(TOKEN_KEY);
  location.reload();
});

// ---- session --------------------------------------------------------------

async function boot() {
  askConfig();
  const params = readHash();
  state.token = state.token || localStorage.getItem(TOKEN_KEY) || '';

  // Who am I? This decides between the three front doors: a signed-in account,
  // the operator token, or nothing. Asking first is what lets a person skip the
  // token screen entirely.
  const me = await whoAmI();
  if (!me) {
    showLogin();
    return;
  }
  if (me.accounts_enabled && !me.signed_in) {
    showSignIn(me);
    return;
  }
  if (me.signed_in) {
    state.me = me;
    state.csrf = me.csrf || '';
    state.csrfHeader = me.csrf_header || '';
  }
  try {
    await refreshTotals();
    await loadUsers();
    showApp();
    // A link straight to an account (or one of its tabverses) opens it.
    const user = params.get('user');
    if (user && state.users.some((u) => u.id === user)) {
      await openAccount(user);
      // a link can name the tab: #token=...&user=usr_...&tab=credentials
      const tab = params.get('tab');
      if (tab) setTab(tab);
      const view = params.get('view');
      if (view === 'records' || view === 'search') {
        if (view === 'search') $('#fts-search').value = params.get('q') || '';
        setDataView(view);
      }
      const tabspace = params.get('tabspace');
      if (tabspace) await openTabspace(tabspace);
    }
  } catch (e) {
    if (e.status === 401) {
      // A stale token in localStorage should not wedge the page.
      localStorage.removeItem(TOKEN_KEY);
      state.token = '';
      showLogin('That token was rejected. Try again.');
    } else {
      showApp();
      banner(e.message);
    }
  }
}

function showLogin(error) {
  $('#view-login').hidden = false;
  $('#view-signin').hidden = true;
  $('#app').hidden = true;
  $('#logout').hidden = true;
  const err = $('#login-error');
  err.hidden = !error;
  err.textContent = error || '';
  $('#admin-token').value = state.token;
  $('#admin-token').focus();
}

// askConfig is the one admin call that needs no token: it says whether this
// deployment has the admin API on at all, so the login screen can explain
// itself instead of rejecting a correctly typed token.
async function askConfig() {
  try {
    const cfg = await api.get('/api/v1/admin/config');
    $('#server-version').textContent = cfg.version ? 'v' + cfg.version : '';
    const hint = $('#login-hint');
    if (!cfg.admin_enabled) {
      hint.innerHTML =
        'This server has no <code>TABVERSED_ADMIN_TOKEN</code> set, so the console and the ' +
        'admin API are off. It is a single tenant deployment: pair the extension once and it owns the server.';
      $('#admin-token').disabled = true;
      $('#login-form button[type=submit]').disabled = true;
      // Nothing behind the sign-in button can work, so do not offer it.
      $('#refresh').hidden = true;
    } else {
      hint.innerHTML =
        'The value of <code>TABVERSED_ADMIN_TOKEN</code> on the server. It is kept in this ' +
        "browser's localStorage only.";
    }
  } catch {
    // A server too old to have the endpoint: leave the default hint alone.
  }
}

async function refreshTotals() {
  const t = await api.get('/api/v1/admin/totals');
  const entities = Object.entries(t.by_entity || {})
    .sort((a, b) => b[1] - a[1])
    .map(([e, n]) => `${e} ${n}`)
    .join('  ');
  $('#totals').textContent =
    `${t.users} accounts · ${t.devices} devices · ${t.active_tokens} live tokens · ` +
    `${t.live_records} records (${t.tombstones} tombstones)` +
    (entities ? ' · ' + entities : '') +
    (t.archived_devices || t.archived_tokens || t.archived_records
      ? ` · archived ${t.archived_devices} devices, ${t.archived_tokens} tokens, ${t.archived_records} records`
      : '');
}

$('#login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const value = $('#admin-token').value.trim();
  if (!value) return;
  state.token = value;
  try {
    await refreshTotals();
    await loadUsers();
    localStorage.setItem(TOKEN_KEY, value);
    showApp();
    banner('');
  } catch (e) {
    showLogin(e.status === 401 ? 'Not the admin token.' : e.message);
  }
});

$('#logout').addEventListener('click', () => {
  localStorage.removeItem(TOKEN_KEY);
  state.token = '';
  state.users = [];
  state.selected = null;
  showLogin();
});

// showApp reveals the app shell, whichever front door was used to get here.
function showApp() {
  $('#view-login').hidden = true;
  $('#view-signin').hidden = true;
  $('#app').hidden = false;
  $('#logout').hidden = !state.token;
}

$('#refresh').addEventListener('click', async () => {
  await refreshTotals();
  await loadUsers();
  if (state.selected) await openAccount(state.selected.id);
  toast('Reloaded', 'good');
});

// openMyAccount is what a signed-in person lands on. An operator sees the
// account list; everyone else goes straight to their own account and the
// sidebar is hidden, because a person has exactly one account and showing them
// a list they cannot use is just a route to a 403.
async function openMyAccount() {
  const operator = state.me && state.me.role === 'admin';
  const roleBadge = $('#account-role');
  roleBadge.hidden = !operator;
  roleBadge.textContent = 'operator';
  $('#sign-out').hidden = !(state.me && state.me.signed_in);
  $('#sidebar-accounts').hidden = !operator;

  await refreshAssumption();

  if (operator) {
    await refreshTotals().catch(() => {});
    await loadUsers();
    const users = state.users;
    if (users.length === 1) {
      await openAccount(users[0].id);
      return;
    }
    if (users.length > 1) {
      showAccountList();
      return;
    }
  }
  if (state.me && state.me.user_id) {
    await openAccount(state.me.user_id);
    await refreshAssumption();
    return;
  }
  // The break-glass token with accounts enabled but no session: the old flow.
  await refreshTotals().catch(() => {});
  await loadUsers();
  if (state.users.length === 1) {
    await openAccount(state.users[0].id);
  } else {
    showAccountList();
  }
}

function showAccountList() {
  $('#empty-state').hidden = false;
  $('#view-account').hidden = true;
  $('#view-tabspace').hidden = true;
  renderUserList();
}

// ---- impersonation (adr/0012) --------------------------------------------
//
// An operator can look at an account as its owner sees it. The server enforces
// read only; this half is the banner, because a read only view that looks like
// a normal one is how an operator walks away believing they changed something.

let assumeTimer = null;

async function refreshAssumption() {
  if (!state.me || !state.me.signed_in) return;
  let info;
  try {
    info = await api.get('/api/v1/console/impersonation');
  } catch {
    return;
  }
  const bar = $('#assume-bar');
  if (!info || !info.assuming) {
    bar.hidden = true;
    clearInterval(assumeTimer);
    assumeTimer = null;
    // back to being ourselves: the account list and the operator's own
    // account are the right things to show
    if (state.me.role === 'admin') {
      await loadUsers();
    }
    return;
  }
  bar.hidden = false;
  const until = info.until ? new Date(info.until) : null;
  const left = until ? Math.max(0, Math.round((until - Date.now()) / 1000)) : 0;
  $('#assume-text').textContent =
    'Read only — you are looking at ' +
    (info.as || info.user_id) +
    ' as they see it' +
    (info.as_by ? ', as ' + info.as_by : '') +
    (left ? ' · ' + Math.floor(left / 60) + 'm ' + (left % 60) + 's left' : '');
  // tick the countdown
  clearInterval(assumeTimer);
  assumeTimer = setInterval(refreshAssumption, 1000);
}

$('#assume-stop').addEventListener('click', async () => {
  try {
    await api.post('/api/v1/console/impersonate/stop');
  } catch (e) {
    toast('Could not stop: ' + e.message, 'bad');
    return;
  }
  $('#assume-bar').hidden = true;
  clearInterval(assumeTimer);
  assumeTimer = null;
  await loadUsers();
  toast('Stopped looking', 'good');
});

async function startImpersonation(userID) {
  if (
    !confirm(
      'Look at this account exactly as its owner sees it?\n\n' +
        'Read only: nothing can be changed while you do, and both the start and ' +
        'the stop are recorded. The window is 15 minutes.',
    )
  ) {
    return;
  }
  try {
    await api.post(
      '/api/v1/admin/users/' + encodeURIComponent(userID) + '/impersonate',
    );
    await refreshAssumption();
    await openAccount(userID);
    toast('Read only — banner at the top', 'good');
  } catch (e) {
    toast(e.message, 'bad');
  }
}

// ---- account list ---------------------------------------------------------

async function loadUsers() {
  const data = await api.get('/api/v1/admin/users');
  state.users = data.users || [];
  if (state.selected) {
    // keep the selection pointing at the refreshed row (new counters)
    const fresh = state.users.find((u) => u.id === state.selected.id);
    if (fresh) state.selected = fresh;
  }
  renderUserList();
}

$('#create-user-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const name = $('#new-user-name').value.trim();
  if (!name) return;
  try {
    const data = await api.post('/api/v1/admin/users', { name });
    $('#new-user-name').value = '';
    await loadUsers();
    await openAccount(data.user.id);
    toast('Account created: ' + data.user.name, 'good');
  } catch (e) {
    toast(e.message, 'bad');
  }
});

// ---- account view ---------------------------------------------------------

async function openAccount(userID) {
  state.selected = state.users.find((u) => u.id === userID) || {
    id: userID,
    name: userID,
  };
  writeHash({ user: userID, tabspace: '' });
  setDataView(state.dataView || 'tabverses');
  const detail = await api.get(
    '/api/v1/admin/users/' + encodeURIComponent(userID),
  );
  state.detail = detail;
  showAccount();
  renderUserList();
  // Reset paging: both listings are per account.
  state.tabspaces = { items: [], total: 0, offset: 0, limit: 24, q: '' };
  state.records = {
    items: [],
    total: 0,
    offset: 0,
    limit: 50,
    q: '',
    entity: '',
    deleted: false,
    archived: false,
  };
  // The "look as them" button is an operator's tool and only makes sense for
  // somebody else's account, and never while already assuming one.
  const operator = state.me && state.me.role === 'admin';
  const isSelf = state.me && state.me.signed_in && state.me.user_id === userID;
  const btn = $('#impersonate');
  btn.hidden = !operator || isSelf || isAssumed();
  if (operator && !isSelf && !isAssumed()) {
    btn.textContent = 'Look as them';
  }

  // a new account starts from the default view, with nothing archived shown
  state.tabspaces.archived = false;
  $('#record-archived').checked = false;
  state.openTabspace = null;
  await Promise.all([loadTabspaces(), loadRecords()]);
}

function renderUserList() {
  const list = $('#user-list');
  clear(list);
  for (const user of state.users) {
    const selected = state.selected && state.selected.id === user.id;
    list.append(
      el(
        'li',
        { class: selected ? 'selected' : '' },
        el(
          'button',
          { type: 'button', onclick: () => openAccount(user.id) },
          el('span', { class: 'u-name' }, user.name),
          el(
            'span',
            { class: 'u-meta' },
            `${user.record_count} records · ${user.device_count} devices · ` +
              `${user.last_activity ? ago(user.last_activity) : 'never synced'}`,
          ),
        ),
      ),
    );
  }
  if (!state.users.length)
    list.append(el('li', { class: 'empty-inline' }, 'no accounts yet'));
}

function showAccount() {
  $('#empty-state').hidden = true;
  $('#view-account').hidden = false;
  $('#view-tabspace').hidden = true;
  renderAccount();
  // An account with no device has nothing to look at in the other two tabs, so
  // the first visit lands on Pair Code. After that the operator's choice wins,
  // and switching accounts keeps the tab they were reading.
  if (state.tab === null) {
    state.tab = state.detail && state.detail.devices.length ? 'data' : 'pair';
  }
  setTab(state.tab);
}

/**
 * The account's three tabs. The rail is on the left, the panel on the right;
 * `hidden` on the others is what keeps the DOM (and the listeners already
 * attached to those tables) alive across tab switches.
 */
function setTab(tab) {
  state.tab = tab;
  writeHash({ tab, tabspace: '' });
  $$('.rail-item').forEach((item) => {
    const active = item.dataset.tab === tab;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  $$('.tab-panel').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tab;
  });
}

$$('.rail-item').forEach((item) => {
  item.addEventListener('click', () => setTab(item.dataset.tab));
});

function renderAccount() {
  const d = state.detail;
  if (!d) return;
  $('#account-name').textContent = d.user.name;
  $('#account-id').textContent =
    `${d.user.id} · created ${dateOf(+new Date(d.user.created_at))}`;

  // The counters belong to the tab they describe: how many credentials can
  // reach the account on one side, how much it has stored on the other. One
  // long strip above all three tabs answered neither.
  const statRow = (node) => {
    clear(node);
    return (k, v) =>
      node.append(
        el(
          'div',
          { class: 'stat' },
          el('div', { class: 'v' }, v),
          el('div', { class: 'k' }, k),
        ),
      );
  };
  const credAdd = statRow($('#credential-stats'));
  const dataAdd = statRow($('#data-stats'));

  const liveTokens = d.tokens.filter((t) => !t.revoked).length;
  const archivedDevices = d.devices.filter((dev) => dev.archived).length;
  const archivedRecords = d.devices.reduce(
    (n, dev) => n + dev.archived_records,
    0,
  );

  credAdd('devices', d.devices.length);
  credAdd('live tokens', liveTokens);
  if (d.tokens.length > liveTokens)
    credAdd('revoked', d.tokens.length - liveTokens);
  if (archivedDevices) credAdd('archived', archivedDevices);

  dataAdd('records', d.stats.live);
  if (d.stats.total > d.stats.live)
    dataAdd('tombstones', d.stats.total - d.stats.live);
  if (archivedRecords) dataAdd('archived', archivedRecords);
  dataAdd('server rev', d.stats.rev_seq);
  for (const [entity, n] of Object.entries(d.stats.by_entity || {}).sort(
    (a, b) => b[1] - a[1],
  )) {
    dataAdd(entity, n);
  }

  // The rail carries the same numbers, so an operator can see what is behind a
  // tab without opening it.
  $('#rail-note-pair').textContent = d.devices.length
    ? d.devices.length + ' paired'
    : 'none yet';
  $('#rail-note-credentials').textContent =
    liveTokens +
    ' live' +
    (archivedDevices ? ' · ' + archivedDevices + ' archived' : '');
  $('#rail-note-data').textContent = d.stats.live + ' records';

  // devices
  const dbody = $('#device-table tbody');
  clear(dbody);
  if (!d.devices.length) {
    dbody.append(
      el(
        'tr',
        { class: 'empty-row' },
        el('td', { colspan: '5' }, 'no devices paired'),
      ),
    );
  }
  for (const dev of d.devices) {
    const name = el('div', {}, dev.name);
    if (dev.archived) {
      // Archived is the operator's tidying, not a security state: the rows stay
      // and keep syncing (adr/0011), so the badge says so.
      name.append(
        el(
          'span',
          {
            class: 'badge archived',
            title:
              'hidden from the default views; still stored and still synced',
          },
          'archived',
        ),
      );
    }
    if (dev.archived_records) {
      name.append(
        el(
          'span',
          { class: 'badge archived' },
          dev.archived_records + ' archived',
        ),
      );
    }
    dbody.append(
      el(
        'tr',
        { class: dev.archived ? 'archived-row' : '' },
        el('td', {}, name, el('div', { class: 'mono muted' }, dev.id)),
        el('td', { class: 'muted' }, ago(+new Date(dev.created_at))),
        el(
          'td',
          { class: 'muted' },
          dev.last_used ? ago(dev.last_used) : 'never',
        ),
        el(
          'td',
          {},
          el(
            'span',
            { class: 'badge ' + (dev.active_tokens ? 'live' : 'revoked') },
            dev.active_tokens + ' live',
          ),
        ),
        el('td', {}, deviceActions(dev)),
      ),
    );
  }

  /**
   * The token row's buttons: revoke while it works, archive once it does not.
   * The two are never offered together - archiving is tidying, revoking is
   * access, and one button that does both is how an operator disables a
   * credential by accident.
   */
  function tokenActions(tok) {
    if (!tok.revoked) {
      return el(
        'button',
        {
          class: 'tiny danger',
          type: 'button',
          onclick: () => revokeToken(tok),
        },
        'Revoke',
      );
    }
    return el(
      'div',
      { class: 'actions' },
      el(
        'button',
        {
          class: 'tiny',
          type: 'button',
          title:
            'Hide this token from the default lists. It stays revoked (ADR 0011).',
          onclick: () => archiveToken(tok, !tok.archived),
        },
        tok.archived ? 'Unarchive' : 'Archive',
      ),
      tok.archived ? null : el('span', { class: 'muted small' }, 'revoked'),
    );
  }

  /**
   * The device row's buttons, in the order the workflow goes: cut access, then
   * retire it, then (optionally) retire what it last wrote. Archive is only
   * offered once there is nothing left to revoke - the server enforces it too,
   * with a 409 the console shows as a sentence rather than a failure.
   */
  function deviceActions(dev) {
    if (dev.active_tokens) {
      return el(
        'button',
        {
          class: 'tiny danger',
          type: 'button',
          onclick: () => revokeDevice(dev),
        },
        'Revoke',
      );
    }
    const buttons = el('div', { class: 'actions' });
    buttons.append(
      el(
        'button',
        {
          class: 'tiny',
          type: 'button',
          title:
            'Hide this device from the default views. Its records stay stored and ' +
            'keep syncing to your devices, and this is reversible (ADR 0011).',
          onclick: () => archiveDevice(dev, false),
        },
        dev.archived ? 'Unarchive' : 'Archive',
      ),
    );
    if (dev.archived_records) {
      buttons.append(
        el(
          'button',
          {
            class: 'tiny',
            type: 'button',
            onclick: () => archiveDeviceRecords(dev, false),
          },
          'Restore records',
        ),
      );
    } else if (state.detail.stats.live) {
      buttons.append(
        el(
          'button',
          {
            class: 'tiny',
            type: 'button',
            title:
              'Hide the records this device last wrote from the default views. ' +
              'They stay stored and keep syncing (ADR 0011).',
            onclick: () => archiveDeviceRecords(dev, true),
          },
          'Archive its records',
        ),
      );
    }
    if (!dev.archived) {
      buttons.append(el('span', { class: 'muted small' }, 'revoked'));
    }
    return buttons;
  }

  async function archiveDevice(dev, archive) {
    const what = archive
      ? 'Archiving hides "' +
        dev.name +
        '" from the default views. Nothing is deleted: ' +
        'its records stay stored and keep syncing to your devices.'
      : 'Bringing "' +
        dev.name +
        '" back into the default views. It stays revoked.';
    if (!confirm(what)) return;
    await runArchive(
      'devices/' + encodeURIComponent(dev.id) + '/archive',
      archive ? 'PUT' : 'DELETE',
      archive ? 'Device archived' : 'Device restored',
    );
  }

  async function archiveDeviceRecords(dev, archive) {
    const what = archive
      ? 'Archiving the records "' +
        dev.name +
        '" last wrote. They stay stored and keep ' +
        "syncing to your devices; they only leave this console's default views. " +
        'A record edited later comes back on its own.'
      : 'Restoring the records "' +
        dev.name +
        '" last wrote. Deleted records stay deleted.';
    if (!confirm(what)) return;
    await runArchive(
      'devices/' + encodeURIComponent(dev.id) + '/records/archive',
      archive ? 'PUT' : 'DELETE',
      archive ? 'Records archived' : 'Records restored',
    );
  }

  async function archiveToken(tok, archive) {
    const what = archive
      ? 'Archiving token ' +
        tok.fingerprint +
        '. It stays revoked; it is only hidden from ' +
        'the default lists.'
      : 'Bringing token ' +
        tok.fingerprint +
        ' back into the lists. It stays revoked.';
    if (!confirm(what)) return;
    await runArchive(
      'tokens/' + encodeURIComponent(tok.hash) + '/archive',
      archive ? 'PUT' : 'DELETE',
      archive ? 'Token archived' : 'Token restored',
    );
  }

  /** Runs an archive call and reports what the server actually changed. */
  async function runArchive(path, method, doneMessage) {
    try {
      const result = await api.call(
        method,
        '/api/v1/admin/users/' +
          encodeURIComponent(state.selected.id) +
          '/' +
          path,
      );
      await openAccount(state.selected.id);
      const n = result ? (result.archived || 0) + (result.unarchived || 0) : 0;
      toast(doneMessage + (n > 1 ? ' (' + n + ' rows)' : ''), 'good');
    } catch (e) {
      // 409 is a precondition, not a failure: the server says what is missing
      // ("revoke it first", "last active 2d ago, needs 30 days") and that is
      // exactly what the operator needs to read.
      toast(
        e.status === 409 ? e.message : 'Archive failed: ' + e.message,
        'bad',
      );
    }
  }

  // tokens
  const tbody = $('#token-table tbody');
  clear(tbody);
  if (!d.tokens.length) {
    tbody.append(
      el('tr', { class: 'empty-row' }, el('td', { colspan: '5' }, 'no tokens')),
    );
  }
  for (const tok of d.tokens) {
    tbody.append(
      el(
        'tr',
        {},
        el(
          'td',
          { class: 'mono' },
          tok.fingerprint,
          tok.archived
            ? el(
                'span',
                {
                  class: 'badge archived',
                  title: 'hidden from the default lists; still revoked',
                },
                'archived',
              )
            : null,
        ),
        el(
          'td',
          {},
          tok.device_name || el('span', { class: 'muted' }, '(unknown device)'),
        ),
        el('td', { class: 'muted' }, ago(+new Date(tok.created_at))),
        el(
          'td',
          { class: 'muted' },
          tok.last_used ? ago(tok.last_used) : 'never',
        ),
        el('td', {}, tokenActions(tok)),
      ),
    );
  }
}

async function revokeToken(tok) {
  if (
    !confirm(
      'Revoke token ' +
        tok.fingerprint +
        ' on ' +
        (tok.device_name || 'device') +
        '? The device will stop syncing and has to pair again.',
    )
  )
    return;
  try {
    await api.del(
      `/api/v1/admin/users/${encodeURIComponent(state.selected.id)}/tokens/${encodeURIComponent(tok.hash)}`,
    );
    await openAccount(state.selected.id);
    toast('Token revoked', 'good');
  } catch (e) {
    toast(e.message, 'bad');
  }
}

async function revokeDevice(dev) {
  if (
    !confirm(
      'Revoke every token of "' +
        dev.name +
        '"? The device will stop syncing and has to pair again.',
    )
  )
    return;
  try {
    await api.del(
      `/api/v1/admin/users/${encodeURIComponent(state.selected.id)}/devices/${encodeURIComponent(dev.id)}`,
    );
    await openAccount(state.selected.id);
    toast('Device revoked', 'good');
  } catch (e) {
    toast(e.message, 'bad');
  }
}

$('#invite-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const ttl = parseInt($('#invite-ttl').value, 10) || 900;
  try {
    const data = await api.post(
      `/api/v1/admin/users/${encodeURIComponent(state.selected.id)}/invites`,
      {
        ttl_seconds: ttl,
      },
    );
    const box = $('#invite-result');
    clear(box);
    box.hidden = false;

    // The code is single use, shown once, and has to be carried to another
    // machine by hand, so it gets a copy button and a select-all fallback.
    const code = el('div', { class: 'code', id: 'invite-code' }, data.code);
    box.append(
      el(
        'div',
        { class: 'code-row' },
        code,
        copyButton(data.code, 'Copy', () => selectText(code)),
      ),
      el(
        'div',
        { class: 'expiry' },
        'single use · expires ' +
          new Date(data.expires_at).toLocaleTimeString() +
          ' · paste it into the extension on the device you are pairing',
      ),
    );

    // The server URL is always needed alongside the code, and
    // location.origin is the address this browser used to reach the console,
    // which is exactly what the extension should be pointed at.
    const url = location.origin;
    const urlNode = el('span', { class: 'server-url' }, url);
    const urlBox = $('#server-url-box');
    clear(urlBox);
    urlBox.hidden = false;
    urlBox.append(
      el('span', { class: 'muted small' }, 'server URL for the extension: '),
      urlNode,
      copyButton(url, 'Copy', () => selectText(urlNode)),
    );
  } catch (e) {
    toast(e.message, 'bad');
  }
});

/** Selects a node's text so a refused copy can still be pasted with Ctrl+C. */
function selectText(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function isAssumed() {
  return !$('#assume-bar').hidden;
}

$('#impersonate').addEventListener('click', () => {
  if (state.selected) startImpersonation(state.selected.id);
});

$('#rename-user').addEventListener('click', async () => {
  const name = prompt('New account name', state.detail.user.name);
  if (name == null) return;
  try {
    await api.put(
      `/api/v1/admin/users/${encodeURIComponent(state.selected.id)}`,
      { name },
    );
    await loadUsers();
    await openAccount(state.selected.id);
    toast('Renamed', 'good');
  } catch (e) {
    toast(e.message, 'bad');
  }
});

$('#delete-user').addEventListener('click', async () => {
  const name = state.detail.user.name;
  const typed = prompt(
    `Deleting "${name}" removes the account, its ${state.detail.stats.total} records, ` +
      `its devices and its tokens. This cannot be undone.\n\nType the account name to confirm:`,
  );
  if (typed !== name) return;
  try {
    await api.del(
      '/api/v1/admin/users/' + encodeURIComponent(state.selected.id),
    );
    state.selected = null;
    state.detail = null;
    await loadUsers();
    $('#view-account').hidden = true;
    $('#empty-state').hidden = false;
    toast('Account deleted', 'good');
  } catch (e) {
    toast(e.message, 'bad');
  }
});

// ---- tabverse browsing (read only) ----------------------------------------

$('#tabspace-search').addEventListener(
  'input',
  debounce(async () => {
    state.tabspaces.q = $('#tabspace-search').value.trim();
    state.tabspaces.offset = 0;
    await loadTabspaces();
  }, 250),
);

async function loadTabspaces() {
  const s = state.tabspaces;
  const params = new URLSearchParams({ limit: s.limit, offset: s.offset });
  if (s.q) params.set('q', s.q);
  const data = await api.get(
    `/api/v1/admin/users/${encodeURIComponent(state.selected.id)}/tabspaces?` +
      params,
  );
  s.items = data.tabspaces || [];
  s.total = data.total;
  renderTabspaces();
}

function renderTabspaces() {
  const list = $('#tabspace-list');
  clear(list);
  const s = state.tabspaces;
  $('#data-subtitle').textContent =
    `${state.detail.user.name} · ${s.total} tabverse${s.total === 1 ? '' : 's'} stored` +
    (s.q ? ` matching "${s.q}"` : '');
  if (!s.items.length) {
    list.append(
      el(
        'p',
        { class: 'empty-inline' },
        s.q
          ? 'no tabverse matches that filter'
          : 'no tabverses stored for this account yet',
      ),
    );
  }
  for (const ts of s.items) {
    const counts = el('div', { class: 'counts' });
    const pill = (n, label) =>
      n > 0 && counts.append(el('span', { class: 'badge' }, `${n} ${label}`));
    pill(ts.tab_count, 'tabs');
    pill(ts.notes, 'notes');
    pill(ts.todos, 'todos');
    pill(ts.bookmarks, 'bookmarks');
    pill(ts.closed_tabs, 'history');
    if (ts.groups)
      counts.append(el('span', { class: 'badge' }, ts.groups + ' groups'));
    list.append(
      el(
        'button',
        {
          class: 'tabspace-card',
          type: 'button',
          onclick: () => openTabspace(ts.id),
        },
        el('span', { class: 'name' }, ts.name),
        el(
          'span',
          { class: 'when' },
          'updated ' + ago(ts.updated_at) + ' · rev ' + ts.rev,
        ),
        counts,
      ),
    );
  }
  renderPager($('#tabspace-pager'), s, loadTabspaces);
}

function renderPager(node, s, reload) {
  clear(node);
  const from = s.total ? s.offset + 1 : 0;
  const to = Math.min(s.offset + s.limit, s.total);
  node.append(
    el(
      'button',
      {
        class: 'ghost',
        type: 'button',
        disabled: s.offset <= 0,
        onclick: () => {
          s.offset = Math.max(0, s.offset - s.limit);
          reload();
        },
      },
      '← Newer',
    ),
    el('span', {}, `${from}–${to} of ${s.total}`),
    el(
      'button',
      {
        class: 'ghost',
        type: 'button',
        disabled: s.offset + s.limit >= s.total,
        onclick: () => {
          s.offset += s.limit;
          reload();
        },
      },
      'Older →',
    ),
  );
}

async function openTabspace(tabspaceID) {
  writeHash({ tabspace: tabspaceID });
  const bundle = await api.get(
    `/api/v1/admin/users/${encodeURIComponent(state.selected.id)}/tabspaces/${encodeURIComponent(tabspaceID)}`,
  );
  state.openTabspace = bundle;
  // the detail view replaces the whole account view, tabs included
  $('#view-account').hidden = true;
  $('#view-tabspace').hidden = false;
  renderTabspace();
}

$('#tabspace-back').addEventListener('click', () => {
  state.openTabspace = null;
  writeHash({ tabspace: '' });
  $('#view-tabspace').hidden = true;
  $('#view-account').hidden = false;
});

function renderTabspace() {
  const b = state.openTabspace;
  const ts = b.tabspace;
  $('#tabspace-name').textContent = ts.name;
  $('#tabspace-meta').textContent =
    `${ts.id} · updated ${ago(ts.updated_at)} · rev ${ts.rev} · ${bytes(jsonSize(b))}` +
    (ts.created_at ? ` · created ${dateOf(ts.created_at)}` : '');

  const body = $('#tabspace-body');
  clear(body);

  // Tabs, in the tabverse's own order, with the tab groups it remembers.
  // The groups are chrome's, not ours: they only carry a colour and a title,
  // and their ids are the tabverse's own tab ids.
  const groupOf = {};
  const groups = Array.isArray(b.tabspace_data && b.tabspace_data.tabGroups)
    ? b.tabspace_data.tabGroups
    : [];
  for (const g of groups) for (const id of g.tabIds || []) groupOf[id] = g;

  const tabSection = el(
    'div',
    { class: 'section' },
    el('h3', {}, 'Tabs ', el('span', { class: 'count-pill' }, b.tabs.length)),
  );
  if (!b.tabs.length)
    tabSection.append(
      el('p', { class: 'empty-inline' }, 'no tabs in this tabverse'),
    );
  else {
    const ul = el('ul', { class: 'tabs-list' });
    let currentGroup = null;
    for (const tab of b.tabs) {
      const g = groupOf[tab.id];
      const gkey = g ? g.id : null;
      if (gkey !== currentGroup) {
        currentGroup = gkey;
        if (g)
          ul.append(
            el(
              'li',
              { class: 'group-label' },
              (g.title || 'group') + (g.color ? ' · ' + g.color : ''),
            ),
          );
      }
      const flags = el('div', { class: 'flags' });
      if (tab.data.pinned)
        flags.append(el('span', { class: 'badge' }, 'pinned'));
      if (tab.data.suspended)
        flags.append(el('span', { class: 'badge' }, 'suspended'));
      const fav = tab.data.favIconUrl
        ? el('img', {
            class: 'fav',
            src: tab.data.favIconUrl,
            alt: '',
            loading: 'lazy',
            onerror: (e) => e.target.remove(),
          })
        : el('span', { class: 'fav' });
      const url = tab.data.url
        ? el(
            'a',
            {
              class: 'u',
              href: tab.data.url,
              target: '_blank',
              rel: 'noreferrer noopener',
            },
            tab.data.url,
          )
        : el('span', { class: 'u' }, '(no url)');
      ul.append(
        el(
          'li',
          { class: 'tab-row' },
          fav,
          el('span', { class: 't' }, tab.data.title || '(untitled)'),
          url,
          flags,
        ),
      );
    }
    tabSection.append(ul);
  }
  body.append(tabSection);

  // Notes / todos / bookmarks.
  body.append(
    notesSection('Notes', b.notes, (n) =>
      el(
        'div',
        { class: 'note-body' },
        el('div', { class: 'n' }, n.data.name || '(untitled)'),
        el('div', { class: 'd' }, n.data.data || ''),
      ),
    ),
  );
  const todoSection = el(
    'div',
    { class: 'section' },
    el('h3', {}, 'Todos ', el('span', { class: 'count-pill' }, b.todos.length)),
  );
  if (!b.todos.length)
    todoSection.append(el('p', { class: 'empty-inline' }, 'no todos'));
  else {
    const ul = el('ul', { class: 'tabs-list' });
    for (const t of b.todos) {
      ul.append(
        el(
          'li',
          { class: 'tab-row' + (t.data.completed ? ' done' : '') },
          el('span', { class: 'badge' }, t.data.completed ? '✓' : '○'),
          el('span', { class: 't' }, t.data.content || '(empty)'),
        ),
      );
    }
    todoSection.append(ul);
  }
  body.append(todoSection);

  const bmSection = el(
    'div',
    { class: 'section' },
    el(
      'h3',
      {},
      'Bookmarks ',
      el('span', { class: 'count-pill' }, b.bookmarks.length),
    ),
  );
  if (!b.bookmarks.length)
    bmSection.append(el('p', { class: 'empty-inline' }, 'no bookmarks'));
  else {
    const ul = el('ul', { class: 'tabs-list' });
    for (const bk of b.bookmarks) {
      const url = bk.data.url
        ? el(
            'a',
            {
              class: 'u',
              href: bk.data.url,
              target: '_blank',
              rel: 'noreferrer noopener',
            },
            bk.data.url,
          )
        : el('span', { class: 'u' }, '');
      ul.append(
        el(
          'li',
          { class: 'tab-row' },
          el(
            'span',
            { class: 't' },
            bk.data.name || bk.data.url || '(unnamed)',
          ),
          url,
        ),
      );
    }
    bmSection.append(ul);
  }
  body.append(bmSection);

  // History: tabs closed in this tabverse, newest first.
  const histSection = el(
    'div',
    { class: 'section' },
    el(
      'h3',
      {},
      'Closed tabs (history) ',
      el('span', { class: 'count-pill' }, b.closed_tabs.length),
    ),
  );
  if (!b.closed_tabs.length)
    histSection.append(
      el('p', { class: 'empty-inline' }, 'no closed tabs recorded'),
    );
  else {
    const ul = el('ul', { class: 'tabs-list' });
    for (const c of b.closed_tabs) {
      const url = c.data.url
        ? el(
            'a',
            {
              class: 'u',
              href: c.data.url,
              target: '_blank',
              rel: 'noreferrer noopener',
            },
            c.data.url,
          )
        : el('span', { class: 'u' }, '');
      const when = c.data.closedAt
        ? el('span', { class: 'u' }, ago(c.data.closedAt))
        : null;
      ul.append(
        el(
          'li',
          { class: 'tab-row' },
          el(
            'span',
            { class: 't' },
            c.data.title || c.data.url || '(untitled)',
          ),
          url,
          when,
        ),
      );
    }
    histSection.append(ul);
  }
  body.append(histSection);

  // Raw json of the aggregates, for the curious.
  const agg = el(
    'details',
    { class: 'section' },
    el('summary', {}, 'ordering aggregates (raw)'),
    el('pre', { class: 'mono' }, JSON.stringify(b.aggregates, null, 2)),
  );
  body.append(agg);
}

function notesSection(title, notes, render) {
  const section = el(
    'div',
    { class: 'section' },
    el(
      'h3',
      {},
      `${title} `,
      el('span', { class: 'count-pill' }, notes.length),
    ),
  );
  if (!notes.length)
    section.append(
      el('p', { class: 'empty-inline' }, `no ${title.toLowerCase()}`),
    );
  for (const n of notes) section.append(render(n));
  return section;
}

// ---- raw record browser ---------------------------------------------------

$('#record-search').addEventListener(
  'input',
  debounce(async () => {
    state.records.q = $('#record-search').value.trim();
    state.records.offset = 0;
    await loadRecords();
  }, 250),
);
$('#record-entity').addEventListener('change', async () => {
  state.records.entity = $('#record-entity').value;
  state.records.offset = 0;
  await loadRecords();
});
$('#record-deleted').addEventListener('change', async () => {
  state.records.deleted = $('#record-deleted').checked;
  state.records.offset = 0;
  await loadRecords();
});

// Archived records are hidden by default; the toggle is how an operator looks
// at what they have retired (ADR 0011). The tabverse list follows it, so the
// two views never disagree about what is visible.
$('#record-archived').addEventListener('change', async () => {
  state.records.archived = $('#record-archived').checked;
  state.tabspaces.archived = state.records.archived;
  state.records.offset = 0;
  state.tabspaces.offset = 0;
  await Promise.all([loadRecords(), loadTabspaces()]);
  if (state.dataView === 'search') await runSearch();
});

async function loadRecords() {
  if (!state.selected) return;
  const s = state.records;
  const params = new URLSearchParams({ limit: s.limit, offset: s.offset });
  if (s.q) params.set('q', s.q);
  if (s.entity) params.set('entity', s.entity);
  if (s.deleted) params.set('deleted', '1');
  if (s.archived) params.set('archived', '1');
  const data = await api.get(
    `/api/v1/admin/users/${encodeURIComponent(state.selected.id)}/records?` +
      params,
  );
  s.items = data.records || [];
  s.total = data.total;
  renderRecords();
}

function renderRecords() {
  const list = $('#record-list');
  clear(list);
  const s = state.records;
  $('#data-subtitle').textContent =
    `${state.detail.user.name} · ${s.total} raw record${s.total === 1 ? '' : 's'}` +
    (s.entity ? ` of entity ${s.entity}` : '') +
    (s.q ? ` matching "${s.q}"` : '') +
    (s.deleted ? ' · tombstones included' : '');
  if (!s.items.length) {
    list.append(
      el(
        'p',
        { class: 'empty-inline' },
        s.q || s.entity
          ? 'no record matches'
          : 'no records stored for this account',
      ),
    );
  }
  for (const rec of s.items) {
    let pretty = rec.payload;
    try {
      pretty = JSON.stringify(JSON.parse(rec.payload), null, 2);
    } catch {
      /* not json: show as stored */
    }
    const head = el(
      'div',
      { class: 'head' },
      el('span', { class: 'e' }, rec.entity),
      el('span', { class: 'mono muted' }, rec.id),
    );
    if (rec.deleted)
      head.append(el('span', { class: 'badge revoked' }, 'tombstone'));
    head.append(
      el(
        'span',
        { class: 'muted small' },
        'rev ' + rec.rev + ' · updated ' + ago(rec.updated_at),
      ),
    );
    list.append(el('div', { class: 'record' }, head, el('pre', {}, pretty)));
  }
  renderPager($('#record-pager'), s, loadRecords);
}

// ---- full text search -----------------------------------------------------

// The same FTS5 index the extension queries (ADR 0008), scoped to one account.
// Every whitespace separated term must match and the last one is a prefix, so
// results narrow as the operator types.
$('#fts-search').addEventListener('input', debounce(runSearch, 250));
$('#fts-entity').addEventListener('change', runSearch);

async function runSearch() {
  const q = $('#fts-search').value.trim();
  const list = $('#search-list');
  clear(list);
  if (!state.selected) return;
  writeHash({ q });
  $('#data-subtitle').textContent =
    `${state.detail.user.name} · searching for "${q}"`;
  if (!q) {
    list.append(
      el('p', { class: 'empty-inline' }, 'type to search this account'),
    );
    return;
  }
  const params = new URLSearchParams({ q });
  const entity = $('#fts-entity').value;
  if (entity) params.set('entity', entity);
  // the search view follows the same "show archived" toggle as the listings, so
  // a search can never surface a record the list beside it is hiding
  if ($('#record-archived').checked) params.set('archived', '1');
  let data;
  try {
    data = await api.get(
      `/api/v1/admin/users/${encodeURIComponent(state.selected.id)}/search?` +
        params,
    );
  } catch (e) {
    list.append(el('p', { class: 'empty-inline' }, e.message));
    return;
  }
  const hits = data.hits || [];
  $('#data-subtitle').textContent =
    `${state.detail.user.name} · ${hits.length} hit${hits.length === 1 ? '' : 's'} for "${q}"`;
  if (!hits.length) {
    list.append(el('p', { class: 'empty-inline' }, 'nothing matched'));
    return;
  }
  for (const hit of hits) {
    const head = el(
      'div',
      { class: 'head' },
      el('span', { class: 'e' }, hit.entity),
    );
    head.append(
      el('span', { class: 'muted small' }, 'score ' + hit.score.toFixed(2)),
    );
    // A hit names the tabverse it belongs to, exactly like the extension's
    // search does (ADR 0008), so one click opens the tabverse it came from.
    if (hit.tabspace_id) {
      head.append(
        el(
          'button',
          {
            class: 'link',
            type: 'button',
            onclick: () => openTabspace(hit.tabspace_id),
          },
          'open tabverse →',
        ),
      );
    }
    const body = el('div', {}, el('div', { class: 't' }, hit.title || hit.id));
    if (hit.url) {
      body.append(
        el(
          'a',
          {
            class: 'u',
            href: hit.url,
            target: '_blank',
            rel: 'noreferrer noopener',
          },
          hit.url,
        ),
      );
    }
    if (hit.snippet) body.append(el('pre', {}, hit.snippet));
    list.append(el('div', { class: 'record' }, head, body));
  }
}

// ---- view tabs ------------------------------------------------------------

function setDataView(view) {
  state.dataView = view;
  writeHash({ view });
  $$('.tab').forEach((t) => {
    const active = t.dataset.view === view;
    t.classList.toggle('active', active);
    t.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  $('#data-tabverses').hidden = view !== 'tabverses';
  $('#data-records').hidden = view !== 'records';
  $('#data-search').hidden = view !== 'search';
  if (view === 'search') runSearch();
}

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => setDataView(tab.dataset.view));
});

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Populate the entity filters once, from the closed set the server validates.
const ENTITIES = [
  'tabspace',
  'tab',
  'note',
  'todo',
  'bookmark',
  'closedtab',
  'allnote',
  'alltodo',
  'allbookmark',
];
for (const entity of ENTITIES) {
  $('#record-entity').append(el('option', { value: entity }, entity));
  // Aggregates are id lists: they are not in the FTS index (ADR 0008), so
  // offering them here would only ever return nothing.
  if (!entity.startsWith('all'))
    $('#fts-entity').append(el('option', { value: entity }, entity));
}

boot();
