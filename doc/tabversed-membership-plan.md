# Plan: a credit-funded membership (server + console)

Status: **plan** (2026-10). Server + console. Follows the server pivot
(`adr/0001`), accounts (`adr/0012`/`adr/0013`), the operator surface
(`adr/0009`/`adr/0014`), per-account content databases (`adr/0027`), the
login/registration split (`adr/0029`) and the official flavour (`adr/0024`). It
gates the sync a paired device may do on a per-account lease that credits fund,
so it wants an ADR of its own (`adr/0032`).

## 0. What is being asked

1. **A membership is required to use the system.** A person needs a valid
   membership for their paired device to keep syncing; without one the account
   still exists but the data stops moving.
2. **Membership is a 30-day lease.** A period is 30 days; the lease ends unless
   it is renewed.
3. **Credits fund the lease.** A balance is kept per account and a period costs
   credits. The credits are an internal currency so a payment provider can be
   wired to them later without changing the model.
4. **An operator can view and manage any account's membership**: balance,
   expiry, status, grant/deduct, extend, mark unlimited, force-close.
5. **Expiry is not deletion.** An expired account and its data are kept for
   **90 days**, during which the owner can still sign in to a **read-only
   console** - view their own data and **download** it - while sync is already
   stopped. After the window the account and its content are closed.
6. **A master switch.** The whole system can be turned off, in which case every
   account has **unlimited** membership and none of the above applies.

## 1. Where we are (grounded)

- **The sync gate already exists, once.** Every device-token route goes through
  `Server.auth` (`internal/api/server.go:212`) and the WebSocket through
  `handleStream` (`internal/api/stream.go:25`). Both resolve the bearer token
  with `store.LookupToken`; that is the single choke point a membership check
  belongs in.
- **The console has its own credential path.** Sessions resolve through
  `accounts.Service.AccountFromRequest` (`internal/accounts/service.go:692`) and
  the operator routes through `consoleCredential`/`adminOnly`
  (`internal/api/admin.go:40`, `:97`). Console sign-in must stay open when a
  membership lapses, or the owner cannot renew or export.
- **An account already has a disable switch.** `Account.CanLogin`
  (`internal/store/accounts.go:112`) and the `users.disabled_at` column feed
  `updater` (`internal/accounts/service.go:410`), which blanks `u.ID` and
  refuses the session. Membership is a *different* refusal: the account is fine,
  the subscription is not, and the console must remain reachable.
- **Accounts live in the central database.** `users` has `role`,
  `disabled_at`, `pending_at`, `terms_accepted_at` added by additive migration
  (`internal/store/store.go:270-303`); the schema list starts at `:117`. User
  *content* is per account (`adr/0027`, `internal/store/userdb.go`), so
  membership belongs in the central file and no content file is opened to read
  it.
- **The configured root already exists.** `config.AdminEmail`
  (`internal/config/config.go`) names the address whose first registration is
  promoted to operator (`accounts.Service.promoteIfFirstOperator`,
  `internal/accounts/service.go:971`). It is the deployment's break-glass
  identity, and D3 makes that permanent for membership too.
- **There is already a background worker pattern.** `retention.Run`
  (`internal/retention/retention.go:18`) sweeps every interval with an injected
  `*store.Store` and is started from `serve.go:117`; `counters.Run` sits beside
  it. Membership renewal, expiry and purge are the same shape.
- **The operator can already delete an account and its content.**
  `store.DeleteUser` (`internal/store/admin.go:179`) cascades the central rows
  and removes the per-account file; the 90-day purge calls exactly this, it does
  not invent a second deletion path.
- **Mail already exists.** `accounts.mailSender` (`internal/accounts/sender.go`)
  sends through Resend or SMTP and *logs* when neither is configured. Expiry and
  purge notices reuse it.
- **Every state change is audited.** `store.AppendAudit`
  (`internal/store/accounts.go:612`) with named actions; the ledger and the
  membership lifecycle use it.
- **The ledger has a proven shape.** `user_counters` / `counter_dirty`
  (`internal/store/store.go:200`) keep a cached balance recomputed from an
  authoritative source. Membership keeps an authoritative **ledger** and a
  cached `credits` balance, written in the same transaction.

## 2. Decision summary

| # | Question | Decision |
|---|----------|----------|
| D1 | What is a membership? | A **lease**: valid while `now < memberships.expires_at`. A period is **30 days** (`TABVERSED_MEMBERSHIP_PERIOD_DAYS`, default 30), and it costs **30 credits** (`TABVERSED_MEMBERSHIP_PERIOD_CREDITS`, default 30), so one credit is one day. |
| D2 | Master switch | `server_settings.membership_enabled`, seeded from `TABVERSED_MEMBERSHIP_ENABLED` (default `false`; official build default `true` via the `officialserver` build tag, like `defaultEmailRegistration`). An operator may flip it in the console. Off = every account unlimited, no debits, no expiry, no purge. |
| D3 | Who is exempt? | The **configured root** - the account whose email equals `TABVERSED_ADMIN_EMAIL` - is always unlimited and can never be expired, marked non-unlimited, demoted out of it, or purged. On top of that, operators (`role = admin`) are unlimited, and any account can be marked `unlimited` by an operator. |
| D4 | Where is it enforced? | One helper called by `Server.auth` and `handleStream` after `LookupToken`; and by device pairing. A console session is never refused *outright*: an expired account gets a strictly **read-only console session** (D5b), so the owner can still view and download. |
| D5 | What exactly is refused? | Expired accounts get `402 Payment Required`, code `membership_expired`, with `expires_at`/`retention_until`. The lease is evaluated against `expires_at` on **every request**, so sync stops at the expiry instant - not when the worker next runs. **Both pull and push are refused**, pairing a new device is refused, and a live WebSocket is closed when the account expires. |
| D5b | What may an expired account do? | **Look, and take a copy.** Sign in, read its own data (the existing console browser: `GET …/tabspaces`, `…/tabspaces/{id}`, `…/records`, `…/search`, `/console/search`), and download (D9). Every write is refused: rename, delete tabverse, revoke/archive devices and tokens, pairing, credits, and delete-account. The only mutating calls allowed are **sign out** and **revoke own sessions** (security, not content) and **renew** (the way back). |
| D6 | How does it renew? | A worker debits `PERIOD_CREDITS` and extends `expires_at` by one period while the balance allows, near expiry. Renewing after expiry starts at `now` (no back-dating). An operator extension always wins and does not need credits. |
| D7 | How does a new account start? | On creation, grant `TABVERSED_MEMBERSHIP_TRIAL_CREDITS` (default 30 = one free period, 0 disables) and open the first period. **One trial per account, ever** - an admin reset or a re-enable never re-grants it. Invitations carry no credits of their own; an invited account and an open registration both start the same way. |
| D8 | What is 30 days? | 30 × 24h from the instant, not a calendar month. All instants are unix **milliseconds**, like the rest of the server. |
| D9 | Download | `GET /console/api/v1/console/export` streams the account's own records as **NDJSON** (one JSON object per line, manifest first). Always available to the owner; shown prominently during the 90-day window. |
| D10 | Expiry retention | `TABVERSED_MEMBERSHIP_RETENTION_DAYS` (default 90). During it the account is a **read-only console tenant**: sign-in, view its own data, download; sync and every write refused. After it: `DeleteUser`, audited `membership_closed`. `TABVERSED_MEMBERSHIP_AUTO_PURGE` (default true) turns the automatic close off, leaving the row flagged for an operator. |
| D11 | Notices | Email at expiry, and at 7 and 1 day before the purge, through `mailSender`; if no mail is configured they are logged, exactly like a sign-in link that cannot be sent. Instants recorded so each fires once. |
| D12 | Are tokens/sessions revoked on expiry? | No. The check is live, so renewing restores access with no re-pairing, and the console session survives to renew. `DeleteUser` cascades them on close. |
| D13 | Credits, later money | Integer credits. A purchase writes a `membership_ledger` row with `reason='purchase'`; an optional `payments` table (provider, external id, amount) gives idempotent webhooks. No model change is needed to wire money. |

## 3. The model

```
account (users)
  └── membership (central)        one row per account
        ├── expires_at            lease end, unix ms; 0 = never opened
        ├── credits               cached balance, ledger is authoritative
        ├── unlimited             operator/root exemption
        └── lifecycle stamps       trial_granted_at, last_renewed_at, expired_at,
                                   expired_notified_at, purge_warned_at
        └── membership_ledger      append-only: +grant/+purchase/-period ...
```

The **status is computed, never stored** - a stored enum is one more thing that
can drift from the timestamps:

```go
// internal/membership
type Status string

const (
    StatusUnlimited Status = "unlimited" // switch off, operator, or exempt
    StatusActive    Status = "active"    // now < expires_at
    StatusExpired   Status = "expired"   // grace window, now < expires_at+retention
    StatusClosable  Status = "closable"  // past the grace window
)

// StatusOf takes the two identities that override the lease: exempt is the
// row's own unlimited flag, root is (email == cfg.AdminEmail). Operators are
// handled by the caller passing role.
func StatusOf(now time.Time, m store.Membership, enabled bool, role string, root bool) Status
```

`StatusOf` is a pure function: a table test with no database pins every
boundary (`expires_at == now` is expired; `expires_at + retention == now` is
closable; switch off is unlimited; an operator or the configured root is
unlimited whatever the timestamps say).

## 4. Schema

Two tables and a settings table, in the central database beside `users`
(`internal/store/store.go`). Additive, so an existing deployment gets them on
the next boot with no data step.

```sql
CREATE TABLE IF NOT EXISTS memberships (
  user_id             TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  expires_at          INTEGER NOT NULL DEFAULT 0,  -- unix ms lease end
  credits             INTEGER NOT NULL DEFAULT 0,  -- remaining balance
  unlimited           INTEGER NOT NULL DEFAULT 0,  -- operator exemption
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  last_renewed_at     INTEGER NOT NULL DEFAULT 0,
  trial_granted_at    INTEGER NOT NULL DEFAULT 0,  -- the one trial, once per account
  expired_at          INTEGER NOT NULL DEFAULT 0,  -- first seen expired
  expired_notified_at INTEGER NOT NULL DEFAULT 0,
  purge_warned_at     INTEGER NOT NULL DEFAULT 0
);
-- The worker's two scans: "renew or expire" and "closable".
CREATE INDEX IF NOT EXISTS memberships_expiry ON memberships(expires_at)
  WHERE unlimited = 0;

CREATE TABLE IF NOT EXISTS membership_ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta         INTEGER NOT NULL,             -- + grant/purchase, - period
  balance       INTEGER NOT NULL,             -- balance after this entry
  reason        TEXT NOT NULL,                -- trial|grant|period|adjustment|refund|purchase
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  at            INTEGER NOT NULL,
  detail        TEXT
);
CREATE INDEX IF NOT EXISTS membership_ledger_user
  ON membership_ledger(user_id, at DESC);

CREATE TABLE IF NOT EXISTS server_settings (
  name       TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
```

Notes:

- `credits` is a cache of the ledger; both move in **one transaction**. A
  `CHECK (credits >= 0)` is not used - a negative balance must be either
  prevented by the caller or visible, and the store's `GrantCredits` refuses a
  debit that would go below zero.
- The ledger never cascades to `users.id` on purge *silently*: it does cascade
  (`ON DELETE CASCADE`), and the `audit_log` entry the purge writes keeps the id
  in its `detail` even after `target_user_id` goes NULL, so "what happened to
  this account" survives.
- `server_settings` is general, not membership-specific; the master switch is
  its first key.

No existing table changes: membership is per account, so everything lives in
the two new tables.

## 5. Store API (`internal/store/membership.go`)

| function | what it does |
|---|---|
| `Membership(ctx, userID) (Membership, error)` | one row, `ErrNotFound` when none |
| `EnsureMembership(ctx, userID, trialCredits)` | insert-with-grant if absent; idempotent |
| `GrantCredits(ctx, userID, delta, reason, actor, detail)` | transaction: balance + ledger; refuses a debit below zero |
| `OpenPeriod(ctx, userID, periodMS, price, actor)` | transaction: debit price, advance `expires_at`, stamp `last_renewed_at` |
| `RenewIfFunded(ctx, userID, periodMS, price) (bool, error)` | the worker's atomic "debit if affordable" |
| `SetMembership(ctx, userID, expiresAt, unlimited, detail)` | operator override |
| `ListMemberships(ctx, query) ([]MembershipSummary, error)` | the admin list, joined to counters |
| `Ledger(ctx, userID, limit) ([]LedgerEntry, error)` | newest first |
| `DueForRenewal(ctx, now, leadMS)` | active rows whose lease is near and whose balance can pay |
| `DueForExpiryNotice(ctx, now)` / `DueForPurge(ctx, now, retentionMS)` | lifecycle scans |
| `Setting(ctx, name) (string, bool)` / `PutSetting(ctx, name, value, actor)` | master switch and future flags |

### 5.1 The onboarding grant

The account is created inside `accounts.Register` (`internal/accounts/service.go:556`)
through `UpsertIdentity`, and `created` says whether this call is the one. When
it is, the trial is granted and the first period opened from it, so the account
arrives `active`, not `expired`:

- `ReasonTrial`, `TABVERSED_MEMBERSHIP_TRIAL_CREDITS` (default 30 = one period)
  - or nothing when that is 0, in which case an operator funds the account;
- `trial_granted_at` is stamped in the same transaction, and the grant only runs
  when it is unset, so a **retried submit, an admin reset, a switch toggled off
  and on again, or a worker re-run all grant nothing further**. One 30-credit
  trial per account, ever.

Invitations are deliberately not consulted: an invited account and an open
registration get the same single trial, so there is one onboarding rule and no
second credit source to reason about (`adr/0029` owns who may register; this
plan owns what they get).

## 6. Enforcement

### 6.1 Sync stops at the expiry instant

One helper, so there is exactly one definition of "may this account sync":

```go
// internal/api/membership.go
// requireSyncMembership writes the 402 and returns false when the account may
// not use the system right now. It is a no-op when the switch is off, and it
// reads memberships.expires_at directly - no cache, no sweep in the path.
func (s *Server) requireSyncMembership(w http.ResponseWriter, r *http.Request, userID string) bool
```

- called from `Server.auth` (`internal/api/server.go:212`) right after
  `LookupToken` succeeds;
- called from `handleStream` (`internal/api/stream.go:25`) after the token
  lookup, before the WebSocket upgrade;
- called from `writeDevice` (`internal/api/auth_handlers.go:128`) for both
  pairing doors (`/auth/pair` and `/console/console/pair`).

Because the check is a live read of `expires_at`, **the first sync request after
the lease ends is refused**, whatever the worker is doing. The worker is not in
the enforcement path at all - it only renews (before expiry), notifies and
purges. A server that was down across the expiry instant refuses the moment it
is back, again with no sweep needed.

The one thing a request-time check cannot reach is an **already-open
WebSocket**. Step 2 of the worker closes the account's connections the moment it
observes expiry (`hub.CloseUser`, a new method beside `Publish`/`Count`,
`internal/hub/hub.go:64`), so a client that is idle on the stream is cut off at
the next pass (hourly, or at startup). The stream is a notification channel, not
an authority: a message it receives after expiry can never be acted on, because
the next pull or push is refused anyway.

Refusal body:

```json
{ "error": "membership_expired",
  "message": "your membership has expired; sign in to renew or download your data",
  "expires_at": 1760000000000,
  "retention_until": 1767776000000 }
```

`402 Payment Required` is deliberate: it is distinct from `401` (nobody signed
in), `403` (wrong role) and `503` (busy), so the extension can tell "re-pair"
from "pay" without parsing prose. The extension's sync layer
(`src/data/repo/serverApi.ts`) gains a branch that pauses the outbox and surfaces
the state; that is an extension-side follow-up, not part of the server build.

### 6.2 The console is read-only while expired

An expired account keeps a session - it is the only way to renew or download -
but the session is put in a **read-only mode**. The natural place is the one
middleware every console route already passes through, `consoleCredential`
(`internal/api/admin.go:58`), wrapping the `admin`/`adminOnly` gates:

- **Allowed**: `GET`/`HEAD` on the account's own routes, so the console's data
  browser works unchanged - `GET …/admin/users/{id}`, `…/users/{id}/tabspaces`,
  `…/tabspaces/{id}`, `…/records`, `…/search`, `GET …/console/search`,
  `GET …/console/me`, `GET …/console/membership`, `GET …/console/export`.
- **Refused** with the same `402 membership_expired`: every other method on the
  owner's own account, which today means rename (`PUT …/users/{id}`), delete
  account (`DELETE …/users/{id}`), mint a pairing code (`POST …/invites`),
  revoke/archive devices and tokens, delete a tabverse
  (`DELETE …/tabspaces/{id}`), and `POST …/console/pair`. "Delete my data while
  expired" is not allowed: the data is what the 90-day window is for.
- **Explicit allowlist of mutating calls**: sign out (`POST …/console/signout`,
  which bypasses `consoleCredential` anyway), `POST …/console/revoke-sessions`
  (a security action on credentials, not content) and
  `POST …/console/membership/renew` (the recovery path).

The rule is implemented as "read-only account => method must be GET/HEAD, unless
the path is one of these three", not as a per-handler check, so a route added
later is refused by default rather than silently writable.

Operators are exempt: they are unlimited by role. So is the **configured root**
(the account whose email is `TABVERSED_ADMIN_EMAIL`), independently of role -
no membership route may expire it, mark it non-unlimited, or close it (D3). An
operator *viewing* an expired account (assumed identity) is already refused on
mutating routes (`refuseIfAssumedAndMutating`), and the operator surface itself
is untouched - managing the membership is exactly how the window is resolved.

**What is deliberately not gated:**

- Console sign-in, `/console/me`, the account's own **read** routes, export,
  and the whole operator surface. Locking the owner out of the console would
  make renewal and download impossible.
- The admin's last-operator guarantee (`adr/0013`) is untouched, and the
  configured root is exempt beyond it: a mis-set switch, an empty credit
  balance, or an operator role change can never lock the deployment out. The
  store refuses `close` and `unlimited=false` for the root the same way
  `SetRole` refuses to demote the last admin.

## 7. Lifecycle worker (`internal/membership`, started from `serve.go`)

`membership.Run(ctx, st, sender, cfg, logger)` ticks hourly (and once at start,
like `retention.Run`) and, when the switch is on:

1. **Renew** - `DueForRenewal`: rows whose `expires_at - now <= lead` and whose
   `credits >= 1` get `RenewIfFunded`. `lead` is one day; a period is added per
   run until the balance is spent or the lease is safely ahead. Renewing ahead
   is what keeps a funded account from ever hitting the read-only state.
2. **Expire** - rows past `expires_at` are stamped `expired_at` (first time
   only), audited `membership_expired`, sent the expiry notice, and their open
   WebSocket connections are closed (`hub.CloseUser`) so a stream does not
   outlive the lease.
3. **Warn** - rows `retention` away from deletion get a "your account closes on
   …" notice once (`purge_warned_at`), with a second at one day.
4. **Close** - rows past `expires_at + retention` and `unlimited = 0` are
   passed to `DeleteUser` (`internal/store/admin.go:179`), audited
   `membership_closed` with the id and the last expiry in `detail`. The
   configured root is never eligible. Skipped when `AUTO_PURGE` is off; the row
   is then `closable` and an operator decides.

Every step is idempotent: the stamps make a crash-and-rerun a no-op, and the
renewal is a single transaction. The worker is a no-op when the switch is off.

## 8. Admin API (operator only)

Mounted with the existing `adminOnly` gate (`internal/api/admin.go:97`). Every
mutation audits and, where it changes access, does not need a session bump.

| method | path | body / result |
|---|---|---|
| `GET` | `/console/api/v1/admin/memberships` | the directory: per account `status`, `expires_at`, `credits`, `unlimited`, `retention_until`; `?q=` filters like `ListUsers` |
| `GET` | `/console/api/v1/admin/users/{id}/membership` | one account + balance + last ledger rows |
| `POST` | `/console/api/v1/admin/users/{id}/membership/credits` | `{delta, reason, detail?}` → the account's membership; refuses a negative balance |
| `POST` | `/console/api/v1/admin/users/{id}/membership/extend` | `{periods?, until?, use_credits?}` → the membership; `use_credits` false means an operator grant |
| `POST` | `/console/api/v1/admin/users/{id}/membership/unlimited` | `{unlimited}` |
| `POST` | `/console/api/v1/admin/users/{id}/membership/reset` | clear the lifecycle stamps and reopen a period; funded by credits, or free with `{grant_period:true}`. It never re-grants the one trial |
| `POST` | `/console/api/v1/admin/users/{id}/membership/close` | force the purge now; `?dry_run=1` reports what would be deleted |
| `GET` | `/console/api/v1/admin/users/{id}/membership/ledger` | the append-only ledger |
| `GET` | `/console/api/v1/admin/settings/membership` | the master switch and the effective prices |
| `PUT` | `/console/api/v1/admin/settings/membership` | `{enabled}` → flips the master switch |

`close` is the one path that removes data without the retention clock, and it is
operator-only for exactly that reason; it is the console's "delete account",
made explicit.

## 9. Console (self-service) API

These are the account's **own** routes. When the account is expired they are
part of the read-only surface (D5b): the `GET`s below answer normally, and
`renew` is the one mutation that is allowed. The browser routes the console
already uses (`GET …/admin/users/{id}/tabspaces`, `…/records`, `…/search`) are
the read path and are unchanged.

- `GET /console/api/v1/console/me` (`internal/api/console.go:31`) gains:

  ```json
  "membership": {
    "enabled": true,
    "status": "expired",
    "read_only": true,
    "expires_at": 1760000000000,
    "credits": 0,
    "period_days": 30,
    "retention_until": 1767776000000,
    "days_left": 0,
    "days_until_close": 90,
    "can_export": true
  }
  ```

  `read_only` is what the page keys on to hide every write control; `status` and
the dates are what it draws.
- `GET /console/api/v1/console/membership` - the same block plus the account's
own recent ledger rows.
- `POST /console/api/v1/console/membership/renew` - spend credits to open a
  period now (a no-op when the balance cannot pay; auto-renew normally makes it
  unnecessary, but it makes the balance's purpose visible). **Allowed while
expired** - it is the way back.
- `GET /console/api/v1/console/export` - NDJSON download (D9), allowed at any
  status. It reads the account's own per-user database through `UserDBs`, streams
  `entity,id,updated_at,deleted,payload` one JSON object per line with a
  manifest first line, sets `Content-Disposition: attachment`, and never buffers
  the whole account in memory.

## 10. Console UI

- **AccountView** (`server/ui/views/AccountView.tsx`): a membership card above
  the credentials - status, days left, credits, expiry date, a renew button, and
  a "Download my data" button. During the grace window the card becomes the
  page's headline: expiry date, close date, and the same download button.
- **Read-only mode.** When the account is expired the whole console renders as
  a viewer: the data browser (`StoredDataPanel`, `TabverseList`) is reachable
  and works, and every write control is hidden rather than shown and refused -
  rename, revoke/archive, delete tabverse, pair a device, and the account's own
  delete. A banner names the expiry and close dates and repeats the download
  button. This is the front-end half of the 402 rule in §6.2, and the two must
  agree; the server is the authority either way.
- **AdminPanel** (`server/ui/views/AdminPanel.tsx`): a membership column
  (status pill, expiry, credits) and a dialog to grant/deduct credits, extend,
  toggle unlimited, and read the ledger. This is "view and manage", in the place
  operators already manage accounts.
- **AdminView** (`server/ui/views/AdminView.tsx`): a third tab beside
  *Accounts* and *Registration invites*, or a row in the accounts header, for
  the master switch and the effective period price. When off it says the system
  is disabled and every account is unlimited, and hides the per-account
  controls.
- Types and fetchers go in `server/ui/data/types.ts` and
  `server/ui/data/api.ts`, matching the existing account calls.

## 11. Config

| variable | default | field |
|---|---|---|
| `TABVERSED_MEMBERSHIP_ENABLED` | `false` (`true` on `officialserver`) | `MembershipEnabled` |
| `TABVERSED_MEMBERSHIP_PERIOD_DAYS` | `30` | `MembershipPeriodDays` |
| `TABVERSED_MEMBERSHIP_PERIOD_CREDITS` | `30` | `MembershipPeriodCredits` |
| `TABVERSED_MEMBERSHIP_TRIAL_CREDITS` | `30` | `MembershipTrialCredits` |
| `TABVERSED_MEMBERSHIP_RETENTION_DAYS` | `90` | `MembershipRetentionDays` |
| `TABVERSED_MEMBERSHIP_AUTO_PURGE` | `true` | `MembershipAutoPurge` |

Read in `config.Load` (`internal/config/config.go:240` onward) with the existing
`GetenvBool`/`GetenvInt` helpers. The `officialserver` default goes in
`internal/config/membership_defaults.go` exactly like `official_defaults.go`,
so the binary differs without a second flag to keep in step. The env value only
*seeds* the server setting; the operator's toggle in `server_settings` is the
runtime truth.

## 12. Audit actions

New named actions in `internal/store/accounts.go` beside the existing ones:

```
membership_grant  membership_debit  membership_period  membership_extend
membership_unlimited  membership_expired  membership_renewed
membership_closed  membership_settings_changed
data_exported
```

`data_exported` records that an account pulled its own data (actor = owner), so
"who took a copy, and when" is answerable without logging the payload.

## 13. Rollout

The dangerous transition is turning the switch **on** for an existing
deployment: every account has no row, and a naive reading of "no row =
expired" locks everyone out at once. The rule is therefore **no row is a
trial**: on the first run with the switch on, `EnsureMembership` creates a row
for every account with the configured trial credits and an open period, and
audits it. New accounts get the same treatment at registration.

Phases, each independently shippable:

- **Phase 1 - model only.** Config, tables, `StatusOf`, store API, read-only
  admin `GET /memberships`. No enforcement, nothing changes for anyone, and the
  operator can see the shape. Ships behind `ENABLED=false`.
- **Phase 2 - enforcement + admin management.** The refusal helper in `auth`,
  `handleStream` and pairing; the read-only rule in `consoleCredential`; the
  mutating admin routes; audit. Turning the switch on now has a visible effect.
- **Phase 3 - lifecycle.** The worker: renew, expire, notices, 90-day close.
- **Phase 4 - download.** `/console/export` and the account's own membership
  endpoints.
- **Phase 5 - console UI.** The card, the admin panel, the master switch.
- **Phase 6 - money (later).** A `payments` table and a provider webhook that
  writes a `purchase` ledger row; no change to the lease or the check.

## 14. Testing

- `membership.StatusOf`: a table test over the switch, the role, `unlimited`,
  and each boundary instant.
- `store`: ledger and balance move together; a debit below zero is refused;
  `RenewIfFunded` is idempotent and atomic; `DueFor*` scans return the right
  rows.
- `internal/membership`: the worker with an injected clock - renews when
  funded, stops when not, fires each notice once, purges only past the window,
  no-ops when disabled.
- `api`: an expired device token gets `402 membership_expired` on sync and on
  the stream; a live stream is closed on expiry; an expired console session may
  `GET` its own data and export but gets `402` on rename, delete-tabverse,
  archive, revoke and pair, while sign-out, revoke-sessions and renew still
  work; console sign-in and export work at any status; operator routes are
  unaffected; export streams the account's own records and nothing else.
- `api` timing: enforcement does not depend on the worker - a request made with
  an `expires_at` in the past is refused even when no sweep has run.
- `config`: the official build's default is on, the plain build's is off, and
  env overrides both.

## 15. Settled in review

The first draft left questions open; the review answered them, and the answers
are folded into the decisions above.

1. **Stream staleness of one worker interval is fine.** Keep it simple: the
   expiry pass closes the account's connections, and sync requests are refused
   at the expiry instant regardless. No per-connection timer.
2. **30 credits per period.** One credit is one day, which makes every number
   in the console legible without a conversion.
3. **One 30-credit trial, and no invite credits.** Every account, invited or
   not, starts the same way; the trial is granted once and never re-granted
   (D7, §5.1).
4. **The configured root is the ultimate account.** The address in
   `TABVERSED_ADMIN_EMAIL` is always unlimited and purge-proof, independent of
   role and of the `unlimited` flag - the deployment can never be locked out by
   a membership setting, whatever happens to the operator roles.
