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

// The URL fragment carries the console's state: `token=`, `user=`,
// `view=`, `tabspace=` and `q=`, e.g.
//
//   http://host:8223/#token=SECRET&user=usr_123&tabspace=ts_456
//
// so an operator can paste a link from a terminal and bookmark an account. The
// The fragment carries the console's routing state (which account, which tab),
// which is not secret; the session is a cookie and never travels in a URL.
function readHash() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const rest = params.toString();
  history.replaceState(
    null,
    '',
    location.pathname + location.search + (rest ? '#' + rest : ''),
  );
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

// One credential, and the page never holds it: the session lives in an
// httpOnly cookie the browser sends on its own. The one thing the page does
// hold is the XSRF token, from a deliberately readable cookie, which has to be
// echoed in a header on every state changing request (adr/0012).
//
// credentials is not set: same-origin requests carry the cookie anyway, and
// 'include' would break a plain http deployment on a LAN.
const api = {
  async call(method, path, body) {
    const headers = {};
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

let assumeTimer = null;

const state = {
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
  openTabspace: null, // bundle of the tabverse the drawer is showing
  // the operator's directory filter
  directoryQuery: '',
  // "show archived" for the devices and tokens tables (the stored-data panel
  // has its own, because it filters a different set of rows)
  credentialsArchived: false,
  // the account an active impersonation is looking at, and who started it
  assuming: null,
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

// askConfig is the one call that needs no session: it tells the page which
// build it is talking to and what the deployment offers, so the sign-in screen
// can explain itself instead of being a form that fails when submitted.
async function askConfig() {
  try {
    const cfg = await api.get('/api/v1/admin/config');
    $('#server-version').textContent = cfg.version ? 'v' + cfg.version : '';
  } catch {
    // A server too old to have the endpoint: the defaults in the page stand.
  }
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
    // A deployment too old to have accounts at all: the page will say so.
    return { accounts_enabled: false, signed_in: false, providers: [] };
  }
}

function showApp() {
  $('#view-signin').hidden = true;
  $('#app').hidden = false;
  // The one case where being signed in is not enough: this account is the
  // address the operator is expected to be, and nobody has claimed the role.
  // The server says so, so the page does not have to work it out.
  const hint = $('#operator-hint');
  hint.hidden = !(state.me && state.me.awaiting_operator);
}

// ---- session --------------------------------------------------------------
//
// There is nothing to sign in *to* any more: the session is a cookie the
// browser already has, and the only question is whether the server still
// recognises it.

async function boot() {
  askConfig();
  const params = readHash();
  const me = await whoAmI();
  if (!me) {
    showSignin({ accounts_enabled: false, signed_in: false, providers: [] });
    return;
  }
  if (!me.signed_in) {
    showSignin(me);
    return;
  }
  state.me = me;
  state.csrf = me.csrf || '';
  state.csrfHeader = me.csrf_header || '';
  showApp();
  await openMyAccount();
  const tab = params.get('tab');
  if (tab) setTab(tab);
  // A link may carry a tabverse with it (the drawer writes one into the
  // fragment), and the operator should land on the tabverse it names.
  const tabspace = params.get('tabspace');
  if (tabspace) await openTabspaceDrawer(tabspace);
}

function showSignin(me) {
  $('#app').hidden = true;
  $('#view-signin').hidden = false;
  renderSignInProviders(me.providers || []);
  $('#signin-note').textContent = me.self_hosted
    ? 'The link comes from the server, so check your spam folder.'
    : 'No mail server is configured, so the server prints the link in its own log.';
  $('#signin-email').focus();
}

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
        // No ?from= here on purpose: the server puts the console on it for every
        // provider login (accounts.Service.withConsoleReturn), so the return
        // target is chosen in one place, server side, and a stale console.js
        // cannot leave a sign-in landing on a page of JSON.
        { class: 'provider', href: '/auth/' + name + '/login' },
        name === 'github' ? 'GitHub' : name === 'google' ? 'Google' : name,
      ),
    );
  }
}

$('#signin-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  // Lowercased before it is sent, so the address the server hashes for the
  // session's identity and the one it stores are the same string however the
  // person typed it.
  const email = $('#signin-email').value.trim().toLowerCase();
  if (!email) return;
  const err = $('#signin-error');
  err.hidden = true;
  const button = $('#signin-form button[type=submit]');
  button.disabled = true;
  try {
    // The library owns the form and the send, and it reads the address from the
    // *query string* as `address` (with `user` for the name and `site` for the
    // audience) - a POST body is ignored, so the fields go in the URL. Getting
    // this wrong is a bare 400 with nothing to explain it.
    const query = new URLSearchParams({
      user: email,
      address: email,
      site: location.origin,
    });
    // Our endpoint, not the library's: it creates the account before the link
    // is sent, which is the order the session check needs.
    const res = await fetch('/api/v1/console/signin-link?' + query.toString(), {
      method: 'POST',
    });
    if (!res.ok && res.status !== 200) {
      throw new Error('HTTP ' + res.status);
    }
    err.hidden = false;
    err.className = 'muted small';
    err.textContent =
      'Check your email for the sign-in link. It works once and expires in 30 ' +
      'minutes.';
    $('#signin-email').value = '';
  } catch (e) {
    err.hidden = false;
    err.className = 'error';
    err.textContent = 'Could not send the link: ' + e.message;
  } finally {
    button.disabled = false;
  }
});

$('#sign-out').addEventListener('click', async () => {
  try {
    await api.post('/api/v1/console/signout');
  } catch {
    // Even if the call fails, the page stops pretending it is signed in.
  }
  location.reload();
});

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
    state.assuming = null;
    bar.hidden = true;
    clearInterval(assumeTimer);
    assumeTimer = null;
    // Back to being ourselves: an operator gets the directory again, because
    // that is where they came from and where the next action lives.
    if (state.me.role === 'admin') {
      await showDirectory();
    } else if (state.me && state.me.user_id) {
      await openAccount(state.me.user_id);
    }
    return;
  }
  state.assuming = { user_id: info.user_id, as: info.as, as_by: info.as_by };
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
    // ...and land on the account, not back on the list that started this: the
    // point was to look at *their* tabverses.
    const wasOnAdmin = state.tab === 'admin';
    await refreshAssumption();
    await openAccount(userID);
    if (wasOnAdmin) setTab('data');
    toast('Read only — banner at the top', 'good');
  } catch (e) {
    toast(e.message, 'bad');
  }
}

// openMyAccount opens the account the three tabs act on: your own, or the one
// an operator is currently looking through.
//
// There is no operator-only landing page, and that is the point (adr/0014): an
// operator's own tabverses, devices and pairing codes are one click away, the
// same as everybody else's. The operator's powers are a fourth tab, not a
// different application.
async function openMyAccount() {
  const operator = state.me && state.me.role === 'admin';
  $('#sign-out').hidden = !(state.me && state.me.signed_in);
  $('#account-role').hidden = !operator;
  $('#account-role').textContent = 'operator';
  // The Admin tab is the only operator-only affordance, so it is the only
  // thing that has to appear or disappear.
  $('#rail-admin').hidden = !operator;

  await refreshAssumption();
  // An operator who is looking at somebody is looking at *them*: without this, a
  // reload drops the operator back into their own data while the assumed session
  // is still live.
  const target =
    isAssumed() && state.assuming
      ? state.assuming.user_id
      : state.me && state.me.user_id;
  if (!target) {
    // Signed in, but the server did not say whose account this is: there is
    // nothing to open, and for an operator the Admin tab is the only way in.
    if (operator) {
      setTab('admin');
    }
    return;
  }
  await openAccount(target);
}

function showApp() {
  $('#view-signin').hidden = true;
  $('#app').hidden = false;
  // The one case where being signed in is not enough: this account is the
  // address the operator is expected to be, and nobody has claimed the role yet.
  $('#operator-hint').hidden = !(state.me && state.me.awaiting_operator);
}

// ---- the directory ------------------------------------------------------

// showDirectory is the operator's Admin tab: every account, and what can be
// done to it. There is no create button - registration is the only way an
// account comes into existence (ADR 0014), and a second way to make one is a
// second path to get an address proof wrong.
async function showDirectory() {
  state.users = [];
  await loadUsers();
  renderDirectory();
}

function renderDirectory() {
  const body = $('#directory-table tbody');
  clear(body);
  const total = state.users.length;
  $('#rail-note-admin').textContent = total
    ? total + ' accounts'
    : 'no accounts yet';
  $('#directory-subtitle').textContent =
    total === 0
      ? 'No accounts yet - people appear here when they register.'
      : `${total} account${total === 1 ? '' : 's'} on this server.`;
  $('#directory-filter').disabled = total === 0;

  for (const user of state.users) {
    body.append(directoryRow(user));
  }
  const empty = total === 0;
  $('#directory-empty').hidden = !empty;
  if (empty) {
    $('#directory-empty').textContent =
      "No accounts yet. Give somebody this server's address and let them register - " +
      'that is how an account is created.';
  }
}

// directoryRow is one account, with the powers an operator has over it. The
// controls differ by role and by who is looking, because "delete" means
// something different when it is your own account.
function directoryRow(user) {
  const operator = state.me && state.me.role === 'admin';
  const isSelf = state.me && state.me.user_id === user.id;
  const actions = el('div', { class: 'actions' });

  if (!operator) {
    // A person in the directory - which they should not normally reach at all,
    // since the API refuses it - sees no operator powers.
    actions.append(el('span', { class: 'muted small' }, 'your account'));
  } else if (isSelf) {
    actions.append(el('span', { class: 'muted small' }, 'this is you'));
  } else {
    if (user.role === 'admin') {
      // Operators cannot be looked through: the impersonation refuses it, so
      // the button is not offered rather than offered and refused.
      actions.append(
        el(
          'span',
          {
            class: 'muted small',
            title: 'an operator cannot look through another operator',
          },
          'operator',
        ),
      );
    } else {
      actions.append(
        el(
          'button',
          {
            class: 'tiny',
            type: 'button',
            onclick: () => startImpersonation(user.id),
          },
          'Impersonate',
        ),
      );
    }
    actions.append(
      el(
        'button',
        {
          class: 'tiny',
          type: 'button',
          onclick: () =>
            setRole(user, user.role === 'admin' ? 'user' : 'admin'),
        },
        user.role === 'admin' ? 'Remove operator' : 'Make operator',
      ),
    );
    actions.append(
      el(
        'button',
        {
          class: 'tiny danger',
          type: 'button',
          onclick: () => deleteAccountFromDirectory(user),
        },
        'Delete',
      ),
    );
  }

  const name = el('span', {}, user.name || '(unnamed)');
  if (user.role === 'admin') {
    name.append(el('span', { class: 'badge' }, 'operator'));
  }
  return el(
    'tr',
    {},
    el('td', {}, name, el('div', { class: 'mono muted' }, user.id)),
    el('td', { class: 'muted' }, user.email || '—'),
    el('td', { class: 'muted' }, String(user.device_count ?? 0)),
    el('td', { class: 'muted' }, String(user.record_count ?? 0)),
    el(
      'td',
      { class: 'muted' },
      user.last_activity ? ago(user.last_activity) : 'never',
    ),
    el('td', {}, actions),
  );
}

$('#directory-filter').addEventListener(
  'input',
  debounce(async () => {
    state.directoryQuery = $('#directory-filter').value.trim();
    await loadUsers();
    renderDirectory();
  }, 200),
);

async function setRole(user, role) {
  if (
    !confirm(
      role === 'admin'
        ? `Make ${user.name || user.email} an operator?\n\nThey will be able to see ` +
            'every account on this server, mint pairing codes for anyone, and look ' +
            'through other accounts read only.'
        : `Take operator access away from ${user.name || user.email}?\n\nThey keep their ` +
            'own account, devices and data.',
    )
  ) {
    return;
  }
  try {
    await api.put(
      '/api/v1/admin/users/' + encodeURIComponent(user.id) + '/role',
      { role },
    );
    await loadUsers();
    renderDirectory();
    toast(
      role === 'admin' ? 'They are an operator now' : 'Operator access removed',
      'good',
    );
  } catch (e) {
    // The server refuses to remove the last operator, and says so.
    toast(e.message, 'bad');
  }
}

/**
 * Deleting an account is the most destructive thing the console can do, so the
 * server asks for the id back as `?confirm=` before it will do anything, and the
 * page asks for the name to be typed before it sends that.
 *
 * One function, both buttons. There used to be a second copy of this flow for
 * the account header, and it did not send the confirmation - so that button
 * always came back with `confirmation_required` and deleted nothing. Two copies
 * of a destructive path is how that happened; the directory row and the header
 * button now call this, and say what should happen afterwards themselves.
 *
 * `recordCount` differs by caller: a directory row carries it, the header has
 * the account's own counters.
 */
async function deleteAccount(user, recordCount) {
  const who = user.name || user.email || user.id;
  const records = recordCount ?? user.record_count ?? 0;
  const typed = prompt(
    `Deleting ${who} removes the account, its ${records} record(s), its ` +
      `devices and its tokens. There is no undo.\n\nType ${who} to confirm:`,
  );
  if (typed !== who) {
    return false;
  }
  try {
    await api.del(
      '/api/v1/admin/users/' +
        encodeURIComponent(user.id) +
        '?confirm=' +
        encodeURIComponent(user.id),
    );
    return true;
  } catch (e) {
    toast(e.message, 'bad');
    return false;
  }
}

/** The account header's delete: it takes the account away from under the page. */
async function deleteAccountFromHeader() {
  const user = state.detail.user;
  if (!(await deleteAccount(user, state.detail.stats.total))) {
    return;
  }
  // The console has nothing left to show without an account, and this page was
  // your own: back to the sign-in form, which is the honest end state.
  toast('Account deleted', 'good');
  state.me = null;
  state.selected = null;
  state.detail = null;
  $('#app').hidden = true;
  $('#view-signin').hidden = false;
}

/** A directory row's delete: the account stays, the list refreshes. */
async function deleteAccountFromDirectory(user) {
  if (!(await deleteAccount(user, user.record_count))) {
    return;
  }
  await loadUsers();
  renderDirectory();
  toast((user.name || user.email) + ' deleted', 'good');
}

// ---- account list ---------------------------------------------------------

async function loadUsers() {
  const query = state.directoryQuery
    ? '?q=' + encodeURIComponent(state.directoryQuery)
    : '';
  const data = await api.get('/api/v1/admin/users' + query);
  state.users = data.users || [];
  if (state.selected) {
    // keep the selection pointing at the refreshed row (new counters)
    const fresh = state.users.find((u) => u.id === state.selected.id);
    if (fresh) state.selected = fresh;
  }
  if (state.tab === 'admin') renderDirectory();
}

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
  // a new account starts from the default view, with nothing archived shown
  state.tabspaces.archived = false;
  state.credentialsArchived = false;
  $('#record-archived').checked = false;
  $('#credentials-archived').checked = false;
  state.openTabspace = null;
  await Promise.all([loadTabspaces(), loadRecords()]);
}

function showAccount() {
  $('#view-account').hidden = false;
  // A different account means a different set of tabverses, so whatever the
  // drawer was showing is no longer anything to show.
  closeTabspaceDrawer();
  renderAccount();
  // An account with no device has nothing to look at in the other two tabs, so
  // the first visit lands on Pair Code. After that the choice wins, and
  // switching accounts keeps the tab they were reading.
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
  // The drawer belongs to the account tabs; it has no meaning on the operator's
  // directory, and the hash above has already dropped the tabverse it was on.
  closeTabspaceDrawer();
  $$('.rail-item').forEach((item) => {
    const active = item.dataset.tab === tab;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  $$('.tab-panel').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tab;
  });
  // The account header (name, rename, delete) belongs to the three account
  // tabs; on the Admin tab it would be describing an account nobody is looking
  // at, so it steps aside.
  const onAccount = tab !== 'admin';
  $('#account-head').hidden = !onAccount;
  if (tab === 'admin') {
    // The directory may be stale the moment somebody else registers.
    showDirectory().catch(() => {});
  }
}

$$('.rail-item').forEach((item) => {
  item.addEventListener('click', () => setTab(item.dataset.tab));
});

function renderAccount() {
  const d = state.detail;
  if (!d) return;

  // Archived rows are hidden unless asked for, in *both* tables. Archiving that
  // leaves the row on screen is the same bug in both directions: a control that
  // reports success and changes nothing, and rows that are retired but still
  // cluttering the list (adr/0011).
  const devices = state.credentialsArchived
    ? d.devices
    : d.devices.filter((dev) => !dev.archived);
  const tokens = state.credentialsArchived
    ? d.tokens
    : d.tokens.filter((tok) => !tok.archived);
  const hiddenDevices = d.devices.length - devices.length;
  const hiddenTokens = d.tokens.length - tokens.length;

  // While an operator is looking through this account, the header says so. It
  // is in the title and not only in the banner, because a screenshot or a
  // "what did you see" question should carry the answer with it.
  const assuming = isAssumed();
  $('#account-name').textContent =
    (d.user.name || d.user.id) + (assuming ? ' (impersonated by admin)' : '');
  const mine = state.me && state.me.signed_in && state.me.user_id === d.user.id;
  $('#account-id').textContent = [
    d.user.id,
    mine && state.me.email ? state.me.email : null,
    assuming ? null : `created ${dateOf(+new Date(d.user.created_at))}`,
  ]
    .filter(Boolean)
    .join(' · ');

  // Rename and delete are owner actions. While an operator is looking through
  // the account they are not theirs to use, and the server refuses them anyway -
  // better not to offer them at all.
  const owner =
    !assuming &&
    (!state.me || !state.me.signed_in || state.me.user_id === d.user.id);
  $('#rename-user').hidden = !owner;
  $('#delete-user').hidden = !owner;

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

  const liveTokens = tokens.filter((t) => !t.revoked).length;
  const archivedDevices = d.devices.filter((dev) => dev.archived).length;
  const archivedRecords = d.devices.reduce(
    (n, dev) => n + dev.archived_records,
    0,
  );

  // The counters count the rows in the tables, not the rows in the account: a
  // count that includes a hidden row is the same lie as showing it.
  credAdd('devices', devices.length);
  credAdd('live tokens', liveTokens);
  if (tokens.length > liveTokens)
    credAdd('revoked', tokens.length - liveTokens);
  if (archivedDevices) {
    credAdd(
      'archived',
      state.credentialsArchived ? archivedDevices : hiddenDevices,
    );
  }

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
    devices.length +
    ' paired' +
    (liveTokens ? ' · ' + liveTokens + ' live' : '');
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
  for (const dev of devices) {
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
    // The label, the tooltip, the confirmation *and* the call have to be driven
    // by the same flag. They were not: the label said "Archive" while the call
    // was hardcoded to unarchive, so a live device offered Archive and then
    // asked "bring it back from archive" - and archived nothing.
    buttons.append(
      el(
        'button',
        {
          class: 'tiny',
          type: 'button',
          title: dev.archived
            ? 'Bring this device back into the default views. It stays revoked.'
            : 'Hide this device from the default views. Its records stay stored and ' +
              'keep syncing to your devices, and this is reversible (ADR 0011).',
          onclick: () => archiveDevice(dev, !dev.archived),
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
  if (!tokens.length) {
    tbody.append(
      el(
        'tr',
        { class: 'empty-row' },
        el(
          'td',
          { colspan: '5' },
          hiddenTokens
            ? 'no tokens here - the archived ones are hidden'
            : 'no tokens',
        ),
      ),
    );
  }
  for (const tok of tokens) {
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

$('#credentials-archived').addEventListener('change', () => {
  state.credentialsArchived = $('#credentials-archived').checked;
  renderAccount();
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

$('#delete-user').addEventListener('click', deleteAccountFromHeader);

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
    // A row, not a card: the extension's saved-tabverse list is a list of rows
    // (name over the numbers), and an operator is comparing twenty of them
    // against each other, which is what rows are for. The counts stay on the
    // right, where the eye goes looking for them.
    const counts = el('span', { class: 'row-counts' });
    const pill = (n, label) =>
      n > 0 && counts.append(el('span', { class: 'badge' }, `${n} ${label}`));
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
          class: 'tabverse-row',
          type: 'button',
          title: ts.id,
          onclick: () => openTabspaceDrawer(ts.id),
        },
        el(
          'span',
          { class: 'row-text' },
          el('span', { class: 'row-name' }, ts.name || '(unnamed)'),
          el(
            'span',
            { class: 'row-meta' },
            `${ts.tab_count} tab${ts.tab_count === 1 ? '' : 's'} · updated ` +
              ago(ts.updated_at),
          ),
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

// ---- the tabverse drawer --------------------------------------------------
//
// The tabverse view the extension shows when a saved one is opened, in a drawer
// over the account rather than a page that replaces it.
//
// The action buttons are gone on purpose. "Load to New Window", "Load to Current"
// and "Switch to Tabverse" all act on *this* browser, and a tab stored on this
// account is not openable here - the buttons would be decoration that cannot
// work. What is left is the one action that is about the stored data rather
// than about the browser (adr/0015).

/** The drawer's slide-out duration in console.css. */
const DRAWER_EXIT_MS = 200;

async function openTabspaceDrawer(tabspaceID) {
  let bundle;
  try {
    bundle = await api.get(
      `/api/v1/admin/users/${encodeURIComponent(state.selected.id)}/tabspaces/${encodeURIComponent(tabspaceID)}`,
    );
  } catch (e) {
    // Deleted while this list was on screen (another operator, another tab of
    // the console), or an id this account does not have. Either way there is
    // nothing to open, and saying so beats a drawer with an empty tabverse.
    toast(e.message, 'bad');
    closeTabspaceDrawer();
    return;
  }
  state.openTabspace = bundle;
  writeHash({ tabspace: tabspaceID });
  renderTabspaceDrawer();
  const drawer = $('#drawer');
  drawer.hidden = false;
  // The transition needs the panel laid out before the class lands, or it
  // slides in from nowhere.
  requestAnimationFrame(() => drawer.classList.add('open'));
  $('#drawer-close').focus();
}

function closeTabspaceDrawer() {
  const drawer = $('#drawer');
  if (drawer.hidden) {
    return;
  }
  state.openTabspace = null;
  writeHash({ tabspace: '' });
  drawer.classList.remove('open');
  setTimeout(() => {
    drawer.hidden = true;
  }, DRAWER_EXIT_MS);
}

$('#drawer-close').addEventListener('click', closeTabspaceDrawer);
$('#drawer-backdrop').addEventListener('click', closeTabspaceDrawer);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeTabspaceDrawer();
  }
});

/** "Working on 7 tabs in 2 groups", the line the extension puts above the cards. */
function tabverseSummaryLine(tabs, groups) {
  const line = el(
    'p',
    { class: 'drawer-summary' },
    'Working on ',
    el('b', {}, String(tabs)),
    tabs === 1 ? ' tab' : ' tabs',
  );
  if (groups > 0) {
    line.append(
      ' in ',
      el('b', {}, String(groups)),
      groups === 1 ? ' group' : ' groups',
    );
  }
  return line;
}

/** One tab, shaped like the extension's tab card: favicon, title, url, flags. */
function tabCard(tab) {
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
  const flags = el('span', { class: 'flags' });
  if (tab.data.pinned) flags.append(el('span', { class: 'badge' }, 'pinned'));
  if (tab.data.suspended)
    flags.append(el('span', { class: 'badge' }, 'suspended'));
  return el(
    'li',
    { class: 'tab-card' },
    fav,
    el(
      'span',
      { class: 'tab-card-text' },
      el('span', { class: 'tab-card-title' }, tab.data.title || '(untitled)'),
      url,
    ),
    flags,
  );
}

function renderTabspaceDrawer() {
  const b = state.openTabspace;
  const ts = b.tabspace;
  const groups = Array.isArray(b.tabspace_data && b.tabspace_data.tabGroups)
    ? b.tabspace_data.tabGroups
    : [];
  // Which tab belongs to which group. The groups are chrome's, not ours: they
  // carry a colour and a title, and their members are the tabverse's own tab
  // ids.
  const groupOf = {};
  for (const g of groups) for (const id of g.tabIds || []) groupOf[id] = g;

  $('#drawer-title').textContent = ts.name || '(unnamed tabverse)';
  $('#drawer-meta').textContent =
    `${ts.id} · rev ${ts.rev} · updated ${ago(ts.updated_at)} · ` +
    bytes(jsonSize(b));
  // Looking through somebody else's account is read only, and the server
  // refuses the delete with 403 anyway (adr/0014), so it is not offered.
  $('#drawer-delete').hidden = isAssumed();

  const body = $('#drawer-body');
  clear(body);

  // Created and saved, the way the extension states them: how long ago, with
  // the exact timestamp underneath for when it matters.
  const timeBlock = (label, ms) =>
    el(
      'div',
      { class: 'drawer-when' },
      el('span', { class: 'muted small' }, label),
      el('div', {}, el('b', {}, ago(ms))),
      el('div', { class: 'muted small' }, dateOf(ms)),
    );
  body.append(
    el(
      'div',
      { class: 'drawer-times' },
      timeBlock('Created', ts.created_at),
      timeBlock('Saved', ts.updated_at),
    ),
  );

  body.append(tabverseSummaryLine(b.tabs.length, groups.length));

  if (!b.tabs.length) {
    body.append(el('p', { class: 'empty-inline' }, 'no tabs in this tabverse'));
  } else {
    const cards = el('ul', { class: 'tab-cards' });
    let currentGroup = null;
    for (const tab of b.tabs) {
      const g = groupOf[tab.id];
      const key = g ? g.id : null;
      if (key !== currentGroup) {
        currentGroup = key;
        if (g) {
          cards.append(
            el(
              'li',
              { class: 'group-label' },
              (g.title || 'group') + (g.color ? ' · ' + g.color : ''),
            ),
          );
        }
      }
      cards.append(tabCard(tab));
    }
    body.append(cards);
  }

  // Everything else the tabverse carries is folded away: the extension's own
  // view stops at the tabs, and an operator who wants the notes is looking for
  // something specific enough to click once.
  const more = el(
    'details',
    { class: 'drawer-more' },
    el(
      'summary',
      {},
      `notes, todos, bookmarks and closed tabs stored with it ` +
        `(${b.notes.length + b.todos.length + b.bookmarks.length + b.closed_tabs.length})`,
    ),
  );
  more.append(
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
  more.append(todoSection);

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
  more.append(bmSection);

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
  more.append(histSection);

  // Raw json of the aggregates, for the curious.
  more.append(
    el(
      'details',
      { class: 'section' },
      el('summary', {}, 'ordering aggregates (raw)'),
      el('pre', { class: 'mono' }, JSON.stringify(b.aggregates, null, 2)),
    ),
  );
  body.append(more);
}

// Deleting is a write over somebody else's data, so it is the one button left
// in here and it asks for a typed confirmation (adr/0015).
$('#drawer-delete').addEventListener('click', async () => {
  const b = state.openTabspace;
  if (!b) return;
  const ts = b.tabspace;
  const who = ts.name || ts.id;
  const typed = prompt(
    `Deleting "${who}" removes the tabverse, its ${b.tabs.length} tab(s) and ` +
      `everything stored with it (notes, todos, bookmarks, closed tabs).\n\n` +
      `Every device of this account deletes its own copy on the next sync.\n\n` +
      `Type ${who} to confirm:`,
  );
  if (typed !== who) return;
  try {
    await api.del(
      `/api/v1/admin/users/${encodeURIComponent(state.selected.id)}/tabspaces/` +
        encodeURIComponent(ts.id) +
        '?confirm=' +
        encodeURIComponent(ts.id),
    );
    closeTabspaceDrawer();
    // The list and the account's counters both moved.
    await openAccount(state.selected.id);
    toast(`Deleted ${who}`, 'good');
  } catch (e) {
    toast(e.message, 'bad');
  }
});

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
            onclick: () => openTabspaceDrawer(hit.tabspace_id),
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
