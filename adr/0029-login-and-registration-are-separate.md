# ADR 0029: login and registration are two steps

Status: accepted (2026-10)

Extends [ADR 0012](0012-accounts-are-for-the-console.md) (accounts exist so the
console has no master credential) and follows
[ADR 0017](0017-google-asks-for-the-address.md) (Google supplies the address).

## Context

Account creation used to be a side effect of signing in. `accounts.updater`
runs on every authenticated request; when the claim's subject had no account it
called `UpsertIdentity`, and the login became a registration. That was
deliberate - it is what lets a social login create an account without a second
round trip - but it has a consequence the logs made plain: a session is a
signed JWT with no server-side row of its own, so a session that outlives its
account is indistinguishable from a login that has not registered yet.

The two cases are:

- an account an operator deleted: `retired_subjects` records its subjects, so a
  session for it is refused rather than recreated;
- a database that was wiped or restored from before the account existed: the
  `retired_subjects` row is gone with it, so the very next request from a
  still-valid cookie **recreates** the account from the claim.

The signing key is the second half. With `TABVERSED_AUTH_SECRET` set (the
recommended deployment), the key does not live in the database, so wiping the
database does not invalidate a single session. The two together mean "delete
the database" is silently "log everybody back in and make them new accounts".

The email path already did the two steps in the right order by accident:
`handleConsoleSigninLink` created the account before the link went out
(`EnsureAccount`), because the session is checked against `identities` before
the claim is mapped to one. The social path never had that pre-step, which is
the whole reason `updater` creates on the fly.

## Decision

**Signing in and creating an account are separate, explicit steps, and only the
second one writes an account.**

1. **`updater` no longer creates anything.** On `!known && !retired`, it leaves
   the request unauthenticated as an account and marks the claim with
   `pending_registration=<claim id>`. It writes nothing.

2. **A pending registration is a first-class session state.** `GET
   /console/api/v1/console/me` answers `signed_in: false` with
   `needs_registration: true` and the provider's `email`/`name` when they are
   known, and the console shows the register page. The `pending_registration`
   (invite waiting) field is a different thing and keeps its meaning.

3. **`POST /console/api/v1/console/register` creates the account.** It requires
   the pending claim, a non-empty email and `agree: true`. For the email
   provider the address must hash to the session's own subject (the link proved
   that address and nothing else); a provider that vouched for its address
   (`email_verified`) carries that proof onto the account. It then signs the
   session out, so the next sign-in resolves to the new account.

4. **The invite policy moves to registration.** An invite-only server refuses
   registration with `ErrInviteRequired`; the register page has the invite-code
   field. `handleConsoleSigninLink` no longer creates anything, so it no longer
   pre-checks the invite either - an uninvited address can be sent a link, and
   the register page is where it is told no.

5. **The user agreement is recorded.** The register page requires a checkbox,
   and the acceptance is stamped on the account (`users.terms_accepted_at`) and
   written to the audit log as `terms_accepted`.

6. **Identity subjects are stored without the provider prefix.** The old
   `updater` stored the whole `<provider>_<subject>` claim id, which
   `ResolveAccountID` (which strips the prefix) could never find, so every
   request re-ran the create path to re-resolve it. `Register` stores the bare
   subject, and `ResolveAccountID` still falls back to the old shape so a
   deployment that upgraded is not mistaken for a pile of fresh registrations.

## Consequences

- Deleting a database invalidates accounts but not cookies; the next request
  shows the register page rather than recreating anybody. To actually end
  sessions, rotate the key or revoke the account's sessions (ADR 0021).
- A social login now asks for one more click - the register form - than it did.
  That is the point: the account is the person's decision, with an address a
  provider might not have supplied (GitHub) and an agreement they can read.
- The `users.pending_at` "registration request" flow (an invite-only social login
  that is approved later) is no longer reachable, because no account is created
  to be pending. The store and console code is left in place; the register page's
  invite code is the path now.
- `EnsureAccount` and `Store.EnsureAccountForEmail` are gone; they existed only
  to create ahead of the session.
- The register page is only reachable with a valid provider session. An
  unauthenticated `POST /console/register` is a 401, and a normal account's
  session is refused there too, so it cannot be used to re-register an existing
  account.
