/**
 * Every call the console makes, as effector effects.
 *
 * Effects with handlers rather than the bare `createEffect<Params, Done>()`
 * form, because a handler-less effect has nowhere to put the request: its
 * `doneData` would be the *promise* the caller passed in, and the store would
 * fill up with unresolved promises. The handler here is one line per call and
 * reads exactly like the API it wraps.
 *
 * The client is the module-level `api`, which tests replace with a stub
 * (`setApi`), so none of this reaches a network under vitest.
 */

import { createEffect } from 'effector';

import { api } from './api';
import type {
  AdminSearchResult,
  ArchiveOutcome,
  Impersonation,
  Invite,
  Me,
  RecordPage,
  ServerConfig,
  TabspaceBundle,
  TabspacePage,
  Totals,
  UserDetail,
  UserSummary,
} from './types';

// ---- session ---------------------------------------------------------------

export const loadConfigFx = createEffect<void, ServerConfig>(() =>
  api.getConfig(),
);

export const loadMeFx = createEffect<void, Me | null>(() => api.whoAmI());

export const loadImpersonationFx = createEffect<void, Impersonation>(() =>
  api.impersonation(),
);

export const startImpersonationFx = createEffect<string, void>((userId) =>
  api.startImpersonation(userId),
);

export const stopImpersonationFx = createEffect<void, void>(() =>
  api.stopImpersonation(),
);

export const signOutFx = createEffect<void, void>(() => api.signOut());

export const revokeSessionsFx = createEffect<void, void>(() =>
  api.revokeSessions(),
);

export const revokeUserSessionsFx = createEffect<string, void>((userId) =>
  api.revokeUserSessions(userId),
);

export const loadTotalsFx = createEffect<void, Totals>(() => api.totals());

// ---- accounts --------------------------------------------------------------

export const loadAccountFx = createEffect<string, UserDetail>((userId) =>
  api.getUser(userId),
);

export const loadUsersFx = createEffect<string | undefined, UserSummary[]>(
  (query) => api.listUsers(query),
);

export const renameUserFx = createEffect<
  { userId: string; name: string },
  void
>(({ userId, name }) => api.renameUser(userId, name));

export const setRoleFx = createEffect<{ userId: string; role: string }, void>(
  ({ userId, role }) => api.setRole(userId, role),
);

export const deleteUserFx = createEffect<string, void>((userId) =>
  api.deleteUser(userId),
);

export const createInviteFx = createEffect<
  { userId: string; ttlSeconds: number },
  Invite
>(({ userId, ttlSeconds }) => api.createInvite(userId, ttlSeconds));

export const revokeDeviceFx = createEffect<
  { userId: string; deviceId: string },
  void
>(({ userId, deviceId }) => api.revokeDevice(userId, deviceId));

export const revokeTokenFx = createEffect<
  { userId: string; tokenHash: string },
  void
>(({ userId, tokenHash }) => api.revokeToken(userId, tokenHash));

export const archiveDeviceFx = createEffect<
  { userId: string; deviceId: string; archived: boolean },
  ArchiveOutcome
>(({ userId, deviceId, archived }) =>
  api.setDeviceArchived(userId, deviceId, archived),
);

export const archiveDeviceRecordsFx = createEffect<
  { userId: string; deviceId: string; archived: boolean },
  ArchiveOutcome
>(({ userId, deviceId, archived }) =>
  api.setDeviceRecordsArchived(userId, deviceId, archived),
);

export const archiveTokenFx = createEffect<
  { userId: string; tokenHash: string; archived: boolean },
  ArchiveOutcome
>(({ userId, tokenHash, archived }) =>
  api.setTokenArchived(userId, tokenHash, archived),
);

// ---- stored data -----------------------------------------------------------

export const loadTabspacesFx = createEffect<
  { userId: string; params: Record<string, any> },
  TabspacePage
>(({ userId, params }) => api.listTabspaces(userId, params));

export const loadRecordsFx = createEffect<
  { userId: string; params: Record<string, any> },
  RecordPage
>(({ userId, params }) => api.listRecords(userId, params));

export const searchFx = createEffect<
  {
    userId: string;
    params: { q: string; entity?: string; archived?: boolean };
  },
  AdminSearchResult
>(({ userId, params }) => api.search(userId, params));

// ---- the tabverse drawer ---------------------------------------------------

export const loadTabspaceFx = createEffect<
  { userId: string; tabspaceId: string },
  TabspaceBundle
>(({ userId, tabspaceId }) => api.getTabspace(userId, tabspaceId));

export const deleteTabspaceFx = createEffect<
  { userId: string; tabspaceId: string },
  void
>(({ userId, tabspaceId }) => api.deleteTabspace(userId, tabspaceId));
