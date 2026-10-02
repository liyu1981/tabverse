/**
 * The account view: whose account is on screen, which of its four tabs, and the
 * two archived toggles that filter its tables.
 *
 * The selected account is a separate store from the detail because the two
 * change for different reasons: a link names an account, a reload of the
 * directory refreshes the detail under it.
 */

import { createEvent, createStore } from 'effector';

import {
  archiveDeviceFx,
  archiveDeviceRecordsFx,
  archiveTokenFx,
  createInviteFx,
  deleteUserFx,
  loadAccountFx,
  loadUsersFx,
  renameUserFx,
  revokeDeviceFx,
  revokeTokenFx,
  setRoleFx,
} from '../effects';
import type { Invite, UserDetail, UserSummary } from '../types';

export type AccountTab = 'pair' | 'credentials' | 'data' | 'admin';
export type StoredDataView = 'tabverses' | 'search' | 'records';

export const openAccount = createEvent<string>();
export const setTab = createEvent<AccountTab>();
export const setDataView = createEvent<StoredDataView>();
export const setCredentialsArchived = createEvent<boolean>();
/** One toggle for the whole stored-data panel: the tabverse list, the record
 *  browser and the search all hide the same rows (adr/0011), so it cannot live
 *  in any one of their toolbars. */
export const setDataArchived = createEvent<boolean>();
export const setDirectoryQuery = createEvent<string>();

export const $selectedUserId = createStore<string>('').on(
  openAccount,
  (_, userId) => userId,
);

export const $account = createStore<UserDetail | null>(null)
  .on(loadAccountFx.doneData, (_, detail) => detail)
  // A new account starts from nothing: the tables below are per account, and
  // showing the previous account's rows for a moment is how an operator ends up
  // revoking the wrong device.
  .on(openAccount, () => null);

export const $tab = createStore<AccountTab | null>(null).on(
  setTab,
  (_, tab) => tab,
);

/** Which sub-view of the stored data panel is open; it survives account
 *  switches, because it is a choice about how to look, not about whom. */
export const $dataView = createStore<StoredDataView>('tabverses').on(
  setDataView,
  (_, view) => view,
);

export const $credentialsArchived = createStore<boolean>(false)
  .on(setCredentialsArchived, (_, archived) => archived)
  .on(openAccount, () => false);

export const $dataArchived = createStore<boolean>(false)
  .on(setDataArchived, (_, archived) => archived)
  .on(openAccount, () => false);

export const $directoryQuery = createStore<string>('')
  .on(setDirectoryQuery, (_, query) => query)
  .reset(openAccount);

export const $users = createStore<UserSummary[]>([]).on(
  loadUsersFx.doneData,
  (_, users) => users,
);

export const $invite = createStore<Invite | null>(null)
  .on(createInviteFx.doneData, (_, invite) => invite)
  .on(openAccount, () => null);

/**
 * Devices and tokens with the archived rows taken out, plus how many were.
 *
 * The counters in the panel count the rows in the table, not the rows in the
 * account: a count that includes a hidden row is the same lie as showing it.
 */
export function visibleCredentials(
  detail: UserDetail | null,
  showArchived: boolean,
) {
  const devices = detail?.devices ?? [];
  const tokens = detail?.tokens ?? [];
  const visibleDevices = showArchived
    ? devices
    : devices.filter((dev) => !dev.archived);
  const visibleTokens = showArchived
    ? tokens
    : tokens.filter((tok) => !tok.archived);
  return {
    devices: visibleDevices,
    tokens: visibleTokens,
    hiddenDevices: devices.length - visibleDevices.length,
    hiddenTokens: tokens.length - visibleTokens.length,
  };
}
