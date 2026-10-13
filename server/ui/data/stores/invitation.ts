import { createEvent, createStore } from 'effector';

import {
  clearInvitation,
  loadInvitation,
  stripInvitationFromUrl,
  type Invitation,
} from '../invitation';

/**
 * The invitation a link carried, read once at boot from the URL (or the copy a
 * sign-in round trip saved) and kept until the account is registered.
 *
 * It pre-fills two forms that are shown at different times: the sign-in page's
 * address, and the register page's code. The redirect between them drops the
 * query, which is why this is a store and not just a URL read.
 */
export const $invitation = createStore<Invitation | null>(loadInvitation());

/** Set it after boot (tests, or a link read later). */
export const invitationLoaded = createEvent<Invitation>();

/** The account is registered (or the invitation is abandoned): forget it. */
export const invitationUsed = createEvent();

$invitation
  .on(invitationLoaded, (_, invitation) => invitation)
  .on(invitationUsed, () => null);

invitationUsed.watch(() => {
  clearInvitation();
  stripInvitationFromUrl();
});
