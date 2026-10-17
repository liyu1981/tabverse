/**
 * Membership state (adr/0032): the operator's directory of leases and the
 * master switch. The signed-in account's own card comes from `/console/me`
 * (`$me.membership`), so it does not live here - one source per question.
 */

import { createEvent, createStore } from 'effector';

import {
  loadMembershipSettingsFx,
  loadMembershipsFx,
  setMembershipSettingsFx,
} from '../effects';
import type { MembershipSettings, MembershipSummary } from '../types';

export const setMembershipQuery = createEvent<string>();

export const $membershipQuery = createStore('').on(
  setMembershipQuery,
  (_, query) => query,
);

export const $memberships = createStore<MembershipSummary[]>([]).on(
  loadMembershipsFx.doneData,
  (_, data) => data.memberships || [],
);

export const $membershipEnabled = createStore(false)
  .on(loadMembershipsFx.doneData, (_, data) => data.enabled)
  .on(loadMembershipSettingsFx.doneData, (_, settings) => settings.enabled)
  .on(setMembershipSettingsFx.doneData, (_, settings) => settings.enabled);

export const $membershipSettings = createStore<MembershipSettings | null>(
  null,
).on(loadMembershipSettingsFx.doneData, (_, settings) => settings);
