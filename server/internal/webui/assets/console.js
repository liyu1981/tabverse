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

const api = {
  async call(method, path, body) {
    const headers = { Authorization: 'Bearer ' + state.token };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
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
  tabspaces: { items: [], total: 0, offset: 0, limit: 24, q: '' },
  records: {
    items: [],
    total: 0,
    offset: 0,
    limit: 50,
    q: '',
    entity: '',
    deleted: false,
  },
  openTabspace: null, // bundle
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

// ---- session --------------------------------------------------------------

async function boot() {
  askConfig();
  const params = readHash();
  state.token = state.token || localStorage.getItem(TOKEN_KEY) || '';
  if (!state.token) {
    showLogin();
    return;
  }
  try {
    await refreshTotals();
    await loadUsers();
    showApp();
    // A link straight to an account (or one of its tabverses) opens it.
    const user = params.get('user');
    if (user && state.users.some((u) => u.id === user)) {
      await openAccount(user);
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
  $('#app').hidden = true;
  $('#logout').hidden = true;
  const err = $('#login-error');
  err.hidden = !error;
  err.textContent = error || '';
  $('#admin-token').value = state.token;
  $('#admin-token').focus();
}

function showApp() {
  $('#view-login').hidden = true;
  $('#app').hidden = false;
  $('#logout').hidden = false;
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
    (entities ? ' · ' + entities : '');
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

$('#refresh').addEventListener('click', async () => {
  await refreshTotals();
  await loadUsers();
  if (state.selected) await openAccount(state.selected.id);
  toast('Reloaded', 'good');
});

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
  };
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
  $('#view-data').hidden = false;
  $('#view-tabspace').hidden = true;
  renderAccount();
}

function renderAccount() {
  const d = state.detail;
  if (!d) return;
  $('#account-name').textContent = d.user.name;
  $('#account-id').textContent =
    `${d.user.id} · created ${dateOf(+new Date(d.user.created_at))}`;

  const stats = $('#account-stats');
  clear(stats);
  const add = (k, v) =>
    stats.append(
      el(
        'div',
        { class: 'stat' },
        el('div', { class: 'v' }, v),
        el('div', { class: 'k' }, k),
      ),
    );
  add('records', d.stats.live);
  if (d.stats.total > d.stats.live)
    add('tombstones', d.stats.total - d.stats.live);
  add('server rev', d.stats.rev_seq);
  add('devices', d.devices.length);
  for (const [entity, n] of Object.entries(d.stats.by_entity || {}).sort(
    (a, b) => b[1] - a[1],
  )) {
    add(entity, n);
  }

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
    dbody.append(
      el(
        'tr',
        {},
        el(
          'td',
          {},
          el('div', {}, dev.name),
          el('div', { class: 'mono muted' }, dev.id),
        ),
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
        el(
          'td',
          {},
          dev.active_tokens
            ? el(
                'button',
                {
                  class: 'tiny danger',
                  type: 'button',
                  onclick: () => revokeDevice(dev),
                },
                'Revoke',
              )
            : el('span', { class: 'muted small' }, 'revoked'),
        ),
      ),
    );
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
        el('td', { class: 'mono' }, tok.fingerprint),
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
        el(
          'td',
          {},
          tok.revoked
            ? el('span', { class: 'badge revoked' }, 'revoked')
            : el(
                'button',
                {
                  class: 'tiny danger',
                  type: 'button',
                  onclick: () => revokeToken(tok),
                },
                'Revoke',
              ),
        ),
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
    $('#view-data').hidden = true;
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
  $('#view-account').hidden = true;
  $('#view-data').hidden = true;
  $('#view-tabspace').hidden = false;
  renderTabspace();
}

$('#tabspace-back').addEventListener('click', () => {
  state.openTabspace = null;
  writeHash({ tabspace: '' });
  $('#view-tabspace').hidden = true;
  $('#view-account').hidden = false;
  $('#view-data').hidden = false;
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

async function loadRecords() {
  if (!state.selected) return;
  const s = state.records;
  const params = new URLSearchParams({ limit: s.limit, offset: s.offset });
  if (s.q) params.set('q', s.q);
  if (s.entity) params.set('entity', s.entity);
  if (s.deleted) params.set('deleted', '1');
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
    t.classList.toggle('active', t.dataset.view === view);
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
