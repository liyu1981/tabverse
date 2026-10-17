# ADR 0032: membership is a credit-funded lease

Status: accepted (2026-10). Server + console. Builds on accounts
([ADR 0012](0012-accounts-are-for-the-console.md),
[ADR 0013](0013-no-master-credential.md)), per-account content databases
([ADR 0027](0027-user-content-lives-in-a-per-user-database.md)), the
login/registration split ([ADR 0029](0029-login-and-registration-are-separate.md))
and the official flavour ([ADR 0024](0024-the-root-is-a-site-and-the-api-moved.md)).
Plan: [`doc/tabversed-membership-plan.md`](../doc/tabversed-membership-plan.md).

## Context

The official deployment is the one that charges for sync, and there was no way
to say "this account may use the system until this instant". The pieces that
gate access today are all-or-nothing: an account can log in, a device token can
sync, or neither. There is no notion of a paid period, no balance, and no
lifecycle for an account that stops paying - only `disabled_at`, which reads as
"an operator switched you off" and hides the console entirely.

Three forces shape the design:

- **The extension must not learn about money.** It holds a device token and
  knows one refusal at a time; a lease that expired has to be a distinct,
  machine-readable "pay" answer, not a 401 that reads as "re-pair".
- **The owner must not lose their data by losing access.** A lapsed account
  needs a way to get its content out before anything is deleted, and a window
  in which to do it.
- **A self-hoster must be unaffected.** Most deployments run for one person and
  will never charge anybody; the feature has to be off and invisible by default,
  and a deployment must be able to turn it on without locking itself out.

## Decision

**A membership is a lease that credits fund, and the lease is read live on every
request.**

1. **A lease, not a status.** `memberships.expires_at` is the lease end; a
   period is `TABVERSED_MEMBERSHIP_PERIOD_DAYS` (30) and costs
   `TABVERSED_MEMBERSHIP_PERIOD_CREDITS` (30, so one credit is one day). The
   *status* - `unlimited`, `active`, `expired`, `closable` - is computed from
   the timestamps by `membership.StatusOf`, never stored, so it cannot drift
   from them.

2. **Credits are a ledger, cached on the row.** `membership_ledger` is
   append-only and authoritative; `memberships.credits` is a cache of it, and
   both move in one transaction. A debit that would go below zero is refused.
   Money, later, is one more ledger row (`reason='purchase'`); it does not
   change the lease or the check.

3. **The lease is evaluated at request time.** `requireSyncMembership` reads
   `expires_at` on every device-token request (`Server.auth`, `handleStream`)
   and on pairing, so sync stops at the expiry instant - not when the hourly
   worker next runs. A server that was down across the deadline refuses the
   moment it is back. A live WebSocket is closed by the expiry pass
   (`hub.CloseUser`), because a request-time check cannot reach a socket that is
   already open.

4. **Expiry is a read-only console window, not a lockout.** During
   `TABVERSED_MEMBERSHIP_RETENTION_DAYS` (90) the owner can still sign in, read
   their own data, and download it as NDJSON from
   `GET /console/api/v1/console/export`. Every write is refused with the same
   `402 membership_expired` a device gets: rename, delete a tabverse,
   archive/revoke credentials, pairing, and delete-account. The only mutations
   allowed are sign out, revoke own sessions (security), and renew (the way
   back). The rule lives in `consoleCredential`, the one middleware every
   console route passes through, as "read-only account ⇒ method must be
   GET/HEAD, unless the path is allow-listed", so a route added later is refused
   by default.

5. **One trial, once per account.** `TABVERSED_MEMBERSHIP_TRIAL_CREDITS` (30,
   one period) is granted at account creation and stamped
   (`trial_granted_at`); a retry, a reset, or a switch toggled off and on grants
   nothing further. Invitations do not carry credits - there is one onboarding
   rule.

6. **A master switch, seeded from config and owned at runtime.** The runtime
   truth is `server_settings.membership_enabled`, seeded from
   `TABVERSED_MEMBERSHIP_ENABLED` on first boot (off on a self-hosted build, on
   in the `officialserver` flavour) and flippable by an operator in the console.
   Off means every account is unlimited, and no worker, debit, expiry or purge
   runs. Turning it on enrolls accounts that have never had a row with the
   trial, so enabling it cannot lock an existing deployment out.

7. **The configured root is ultimate, and operators are unlimited.** The
   account whose address is `TABVERSED_ADMIN_EMAIL` is always unlimited and can
   never be closed, independent of role or the `unlimited` flag; operators are
   unlimited by role. A mis-set switch, an empty balance, or an operator-role
   change can never lock the deployment out.

8. **The worker is lifecycle only.** `membership.Run` ticks hourly (and at
   startup): it renews funded leases before they lapse, stamps and notifies
   expiry, warns before the window closes, and closes accounts past it through
   the existing `DeleteUser` (which removes the per-account content file too).
   Notices reuse the account layer's mail sender, and log when none is
   configured.

## Consequences

- The extension needs one new branch: a `402 membership_expired` pauses the
  outbox and surfaces the state, distinct from `401` (re-pair), `403` (role) and
  `503` (busy). That is an extension-side follow-up; the server contract is
  fixed here.
- Every account gains a membership row and can be closed by the retention rule.
  Operators, the configured root, and any account marked `unlimited` are exempt.
- The console gains a membership card, the read-only mode, an operator
  Membership tab (directory, credits, leases, the switch), and NDJSON export.
- `data_exported`, `membership_*` audit actions, and the ledger answer "who had
  access, what happened to it, and who took a copy" without logging payloads.
- The model is deliberately money-free. Wiring a payment provider is a webhook
  that writes a `purchase` ledger row plus an optional `payments` table for
  idempotency; the lease and the check do not change.
- A membership failure is never the console's whole story: a lapsed account can
  always sign in, look, and take its data. Closing it is a separate, reversible
  until the window ends, and audited act.
