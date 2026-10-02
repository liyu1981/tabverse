/**
 * Session state: who the page is talking as, and the read-only window an
 * operator may be standing in.
 *
 * Three stores, because the three have different lifetimes: the deployment's
 * configuration is asked once and never changes, the identity comes from
 * `/console/me` and decides which of the three top-level views is on screen, and
 * the impersonation is polled while it is live because it has a countdown in
 * it.
 */

import { createEvent, createStore } from 'effector';

import {
  loadConfigFx,
  loadImpersonationFx,
  loadMeFx,
  loadTotalsFx,
} from '../effects';
import type { Impersonation, Me, ServerConfig, Totals } from '../types';

export type BootStatus =
  | 'loading'
  | 'signed-out'
  | 'signed-in'
  /** A server too old to have accounts at all: the page says so. */
  | 'no-accounts';

/** The session is gone; every view reacts by going back to the sign-in form. */
export const sessionExpired = createEvent();

export const $config = createStore<ServerConfig | null>(null).on(
  loadConfigFx.doneData,
  (_, config) => config,
);

export const $me = createStore<Me | null>(null)
  .on(loadMeFx.doneData, (_, me) => me)
  .reset(sessionExpired);

export const $bootStatus = createStore<BootStatus>('loading')
  .on(loadMeFx, () => 'loading')
  .on(loadMeFx.doneData, (_, me) => {
    if (!me) return 'signed-out';
    return me.signed_in ? 'signed-in' : 'signed-out';
  })
  .on(sessionExpired, () => 'signed-out');

/** The XSRF echo pair, kept beside the identity it belongs to. */
export const $csrf = createStore<{ header: string; token: string }>({
  header: '',
  token: '',
}).on(loadMeFx.doneData, (_, me) => ({
  header: me?.csrf_header || '',
  token: me?.csrf || '',
}));

export const $impersonation = createStore<Impersonation | null>(null).on(
  loadImpersonationFx.doneData,
  (_, info) => info,
);

/** Read-only is a property of the *answer*, not of a flag the page set itself. */
export const $isAssumed = $impersonation.map((info) => !!info?.assuming);

export const $isOperator = $me.map((me) => me?.role === 'admin');

/** The account the three account tabs act on while nobody is looking through
 *  somebody else. */
export const $ownUserId = $me.map((me) => me?.user_id || '');

export const $totals = createStore<Totals | null>(null).on(
  loadTotalsFx.doneData,
  (_, totals) => totals,
);
