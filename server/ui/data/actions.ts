/**
 * The console's actions: every call the views can make, in one place.
 *
 * The stores hold state and the effects hold the calls; this is the wiring,
 * which is where the three decisions that are not about rendering live:
 *
 *  - **the URL follows the state.** Every action that changes what the console
 *    is looking at writes the fragment too (adr/0018, decision 6), so a
 *    bookmark or a pasted link lands where the operator expects;
 *  - **a 401 is one event.** Whatever call noticed that the session is gone
 *    fires `sessionExpired` once and every view goes back to the sign-in form,
 *    rather than each of them inventing its own answer;
 *  - **a failed action says so.** Success and failure go through the toast
 *    store, so a refusal from the server is visible instead of silent.
 */

import { ApiError, api } from './api';
import { writeHash } from './hashRoute';
import {
  $dataArchived,
  $directoryQuery,
  $selectedUserId,
  $tab,
  openAccount as openAccountEvent,
  setDataArchived,
  setDataView,
  setDirectoryQuery,
  setTab,
} from './stores/accounts';
import {
  $records,
  $search,
  $tabspaces,
  pageRecords,
  pageTabspaces,
  resetBrowse,
} from './stores/browse';
import { closeTabspace, openTabspace } from './stores/drawer';
import {
  $isAssumed,
  $isOperator,
  $ownUserId,
  sessionExpired,
} from './stores/session';
import { reportFailure, reportSuccess } from './stores/toasts';
import {
  archiveDeviceFx,
  archiveDeviceRecordsFx,
  archiveTokenFx,
  createInviteFx,
  deleteTabspaceFx,
  deleteUserFx,
  loadAccountFx,
  loadConfigFx,
  loadImpersonationFx,
  loadMeFx,
  loadRecordsFx,
  loadTabspaceFx,
  loadTabspacesFx,
  loadTotalsFx,
  loadUsersFx,
  renameUserFx,
  revokeDeviceFx,
  revokeSessionsFx,
  revokeTokenFx,
  revokeUserSessionsFx,
  searchFx,
  setRoleFx,
  signOutFx,
  startImpersonationFx,
  stopImpersonationFx,
} from './effects';
import type { AccountTab, StoredDataView } from './stores/accounts';

function route(patch: {
  user?: string;
  tab?: string;
  tabspace?: string;
  view?: string;
  q?: string;
}): void {
  if (typeof window === 'undefined') return;
  writeHash(window.location, window.history, patch);
}

/**
 * The result of an action: whether it worked, and what it produced.
 *
 * An effect whose `Done` is `void` (a rename, a revoke) has no value to test,
 * so the call sites ask `result.ok` rather than `if (!done)`. "The session is
 * gone" is one event out of here and nothing else, so every view reacts to it
 * the same way.
 */
export type Attempt<T> = { ok: true; value: T } | { ok: false; value: null };

async function attempt<T>(
  what: string,
  run: () => Promise<T>,
): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (e) {
    if (e instanceof ApiError && e.isUnauthorized) {
      sessionExpired();
      return { ok: false, value: null };
    }
    reportFailure(what, e);
    return { ok: false, value: null };
  }
}

// ---- boot ------------------------------------------------------------------

export async function boot(): Promise<void> {
  // The version in the top bar is a nicety: a server too old to have the
  // endpoint still serves a console, so a failure here is not an error.
  loadConfigFx().catch(() => undefined);

  const me = await loadMeFx();
  if (!me || !me.signed_in) return;
  api.setCsrf(me.csrf_header || '', me.csrf || '');

  // The read-only window first: an operator who is looking through somebody
  // must land on *them*, not on their own account, or a reload would quietly
  // put them back in their own data while the assumed session is still live.
  // No redirect out of it here - the account below is about to be opened.
  await refreshImpersonation(false);
  loadTotalsFx().catch(() => undefined);

  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const target = params.get('user') || $ownUserId.getState();
  if (!target) return;
  await openAccount(target);
  const tab = params.get('tab');
  if (tab) setTab(tab as AccountTab);
  const tabspace = params.get('tabspace');
  if (tabspace) await openTabspaceById(tabspace);
}

// ---- accounts --------------------------------------------------------------

export async function loadDirectory(): Promise<void> {
  await loadUsersFx($directoryQuery.getState() || undefined);
}

export async function openAccount(userId: string): Promise<void> {
  openAccountEvent(userId);
  closeTabspace();
  route({ user: userId, tabspace: '' });
  resetBrowse();

  const loaded = await attempt('Loading the account', () =>
    loadAccountFx(userId),
  );
  if (!loaded.ok) return;
  const detail = loaded.value;

  // An account with no device has nothing to look at in the other two tabs, so
  // the first visit lands on Pair Code. After that the choice is the operator's
  // and it survives an account switch.
  if ($tab.getState() === null) {
    setTab(detail.devices.length ? 'data' : 'pair');
  }
  await Promise.all([loadTabspaces(), loadRecords()]);
}

export async function changeTab(tab: AccountTab): Promise<void> {
  setTab(tab);
  route({ tab, tabspace: '' });
  // The drawer belongs to the account tabs; on the directory it would describe
  // an account nobody is looking at.
  if (tab === 'admin') {
    closeTabspace();
    await loadDirectory();
  }
  if (tab === 'data' && $search.getState().q) await runSearch();
}

export async function changeDataView(view: StoredDataView): Promise<void> {
  setDataView(view);
  route({ view });
  if (view === 'search') await runSearch();
}

/** The refresh button in the top bar: whatever this account view is showing. */
export async function refreshCurrentView(): Promise<void> {
  const userId = $selectedUserId.getState();
  if (!userId) {
    await boot();
    return;
  }
  if ($tab.getState() === 'admin') {
    await loadDirectory();
    return;
  }
  await openAccount(userId);
  if ($search.getState().q) await runSearch();
}

export async function renameAccount(
  userId: string,
  name: string,
): Promise<boolean> {
  const done = await attempt('Renaming', () => renameUserFx({ userId, name }));
  if (!done.ok) return false;
  await loadDirectory();
  await openAccount(userId);
  reportSuccess('Renamed');
  return true;
}

export async function setUserRole(
  userId: string,
  role: string,
): Promise<boolean> {
  const done = await attempt('Changing the role', () =>
    setRoleFx({ userId, role }),
  );
  if (!done.ok) return false;
  await loadDirectory();
  reportSuccess(
    role === 'admin' ? 'They are an operator now' : 'Operator access removed',
  );
  return true;
}

export async function deleteAccount(userId: string): Promise<boolean> {
  const done = await attempt('Deleting the account', () =>
    deleteUserFx(userId),
  );
  if (!done.ok) return false;
  reportSuccess('Account deleted');
  return true;
}

export async function createInvite(
  userId: string,
  ttlSeconds: number,
): Promise<void> {
  await attempt('Creating a pairing code', () =>
    createInviteFx({ userId, ttlSeconds }),
  );
}

export async function revokeDevice(
  userId: string,
  deviceId: string,
): Promise<void> {
  const done = await attempt('Revoking the device', () =>
    revokeDeviceFx({ userId, deviceId }),
  );
  if (!done.ok) return;
  await openAccount(userId);
  reportSuccess('Device revoked');
}

export async function revokeToken(
  userId: string,
  tokenHash: string,
): Promise<void> {
  const done = await attempt('Revoking the token', () =>
    revokeTokenFx({ userId, tokenHash }),
  );
  if (!done.ok) return;
  await openAccount(userId);
  reportSuccess('Token revoked');
}

type ArchiveCall = () => Promise<{ archived: number; unarchived: number }>;

async function runArchive(
  userId: string,
  what: string,
  done: string,
  call: ArchiveCall,
): Promise<void> {
  const result = await attempt(what, call);
  if (!result.ok) return;
  await openAccount(userId);
  const n = (result.value.archived || 0) + (result.value.unarchived || 0);
  reportSuccess(n > 1 ? `${done} (${n} rows)` : done);
}

export const archiveDevice = (
  userId: string,
  deviceId: string,
  archived: boolean,
) =>
  runArchive(
    userId,
    archived ? 'Archiving the device' : 'Restoring the device',
    archived ? 'Device archived' : 'Device restored',
    () => archiveDeviceFx({ userId, deviceId, archived }),
  );

export const archiveDeviceRecords = (
  userId: string,
  deviceId: string,
  archived: boolean,
) =>
  runArchive(
    userId,
    archived ? 'Archiving the records' : 'Restoring the records',
    archived ? 'Records archived' : 'Records restored',
    () => archiveDeviceRecordsFx({ userId, deviceId, archived }),
  );

export const archiveToken = (
  userId: string,
  tokenHash: string,
  archived: boolean,
) =>
  runArchive(
    userId,
    archived ? 'Archiving the token' : 'Restoring the token',
    archived ? 'Token archived' : 'Token restored',
    () => archiveTokenFx({ userId, tokenHash, archived }),
  );

// ---- the stored data panel -------------------------------------------------

export async function loadTabspaces(): Promise<void> {
  const userId = $selectedUserId.getState();
  if (!userId) return;
  const state = $tabspaces.getState();
  const params: Record<string, any> = {
    limit: state.limit,
    offset: state.offset,
  };
  if (state.q) params.q = state.q;
  if ($dataArchived.getState()) params.archived = true;
  await attempt('Loading tabverses', () => loadTabspacesFx({ userId, params }));
}

export async function loadRecords(): Promise<void> {
  const userId = $selectedUserId.getState();
  if (!userId) return;
  const state = $records.getState();
  const params: Record<string, any> = {
    limit: state.limit,
    offset: state.offset,
  };
  if (state.q) params.q = state.q;
  if (state.entity) params.entity = state.entity;
  if (state.deleted) params.deleted = true;
  if ($dataArchived.getState()) params.archived = true;
  await attempt('Loading records', () => loadRecordsFx({ userId, params }));
}

export async function runSearch(): Promise<void> {
  const userId = $selectedUserId.getState();
  const state = $search.getState();
  const q = state.q.trim();
  route({ q });
  if (!userId || !q) return;
  const params: { q: string; entity?: string; archived?: boolean } = { q };
  if (state.entity) params.entity = state.entity;
  if ($dataArchived.getState()) params.archived = true;
  await attempt('Searching', () => searchFx({ userId, params }));
}

export async function changeDirectoryQuery(query: string): Promise<void> {
  setDirectoryQuery(query);
  await loadDirectory();
}

/** The one toggle for the panel: every view below it hides the same rows. */
export async function toggleDataArchived(archived: boolean): Promise<void> {
  setDataArchived(archived);
  pageTabspaces(0);
  pageRecords(0);
  await Promise.all([loadTabspaces(), loadRecords()]);
  if ($search.getState().q) await runSearch();
}

// ---- the tabverse drawer ---------------------------------------------------

export async function openTabspaceById(tabspaceId: string): Promise<void> {
  const userId = $selectedUserId.getState();
  if (!userId) return;
  openTabspace(tabspaceId);
  route({ tabspace: tabspaceId });
  const opened = await attempt('Opening the tabverse', () =>
    loadTabspaceFx({ userId, tabspaceId }),
  );
  if (!opened.ok) {
    // Deleted while the list was on screen, or an id this account does not have.
    // Either way there is nothing to open, and saying so beats a drawer with an
    // empty tabverse.
    closeTabspace();
    route({ tabspace: '' });
  }
}

export function dismissTabspace(): void {
  closeTabspace();
  route({ tabspace: '' });
}

export async function deleteTabspace(
  userId: string,
  tabspaceId: string,
): Promise<boolean> {
  const done = await attempt('Deleting the tabverse', () =>
    deleteTabspaceFx({ userId, tabspaceId }),
  );
  if (!done.ok) return false;
  dismissTabspace();
  // The list and the account's counters both moved.
  await openAccount(userId);
  reportSuccess('Tabverse deleted');
  return true;
}

// ---- the read-only window --------------------------------------------------

/**
 * Re-reads the read-only window.
 *
 * `redirect` is what makes it "go back to where the window closed from": when
 * the window is not open, an operator gets the directory and a person gets their
 * own account. Boot passes false, because it is about to open an account itself
 * and asking for it twice is one wasted round trip.
 */
export async function refreshImpersonation(redirect = true): Promise<void> {
  const info = await loadImpersonationFx().catch(() => null);
  if (info?.assuming || !redirect) return;
  // Back to being ourselves. An operator gets the directory, because that is
  // where they came from; anybody else gets their own account back.
  if ($isOperator.getState()) {
    setTab('admin');
    await loadDirectory();
    return;
  }
  const own = $ownUserId.getState();
  if (own) await openAccount(own);
}

export async function startImpersonation(userId: string): Promise<boolean> {
  const done = await attempt('Starting the read-only window', () =>
    startImpersonationFx(userId),
  );
  if (!done.ok) return false;
  // ...and land on the account, not back on the list that started this: the
  // point was to look at *their* tabverses.
  const wasOnAdmin = $tab.getState() === 'admin';
  await loadImpersonationFx().catch(() => null);
  await openAccount(userId);
  if (wasOnAdmin) {
    setTab('data');
    route({ tab: 'data' });
  }
  reportSuccess('Read only — the banner at the top says so');
  return true;
}

export async function stopImpersonation(): Promise<void> {
  const done = await attempt('Leaving the read-only window', () =>
    stopImpersonationFx(),
  );
  if (done.ok) await refreshImpersonation();
}

export async function signOut(): Promise<void> {
  // Even when the call fails the page stops pretending it is signed in.
  await signOutFx().catch(() => undefined);
  if (typeof window !== 'undefined') window.location.reload();
}

/**
 * End every console session this account has, this one included.
 *
 * The page reloads whatever the server says, because the cookie it is holding is
 * worthless the moment the call succeeds - and if the call did not succeed, the
 * account's sessions are all still live, so pretending to be signed out would be
 * the one outcome that is not true either way.
 */
export async function revokeSessions(): Promise<void> {
  const done = await attempt('Ending every session', () => revokeSessionsFx());
  if (typeof window !== 'undefined') window.location.reload();
  if (!done.ok) return;
}

/**
 * The operator's version: end every session of somebody else's account.
 *
 * Unlike the call above this does not reload the page, because the operator is
 * not signed out by it - they signed *this* account's sessions out somewhere
 * else. The directory is reloaded so the row's "last active" reflects what just
 * happened.
 */
export async function revokeUserSessions(userId: string): Promise<void> {
  const done = await attempt('Ending every session', () =>
    revokeUserSessionsFx(userId),
  );
  if (!done.ok) return;
  await loadDirectory();
}

export async function requestSigninLink(email: string): Promise<boolean> {
  try {
    await api.requestSigninLink(email.trim().toLowerCase());
    return true;
  } catch (e) {
    reportFailure('Sending the link', e);
    return false;
  }
}
