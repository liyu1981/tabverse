# ADR 0009: an admin token, and a read only console

Status: accepted (2026-09); the operator token is superseded by
[ADR 0013](0013-no-master-credential.md), the console's URL space by
[ADR 0023](0023-the-console-has-its-own-prefix.md)

Extends [ADR 0001](0001-server-authoritative-sync.md) (the sync protocol) and
[ADR 0002](0002-privacy-posture.md) (who may reach a server).

## Context

Two questions came up about the shipped server: *is it multi tenant?* and *is
there any way to see what a user actually stored?*

The answers were "sort of" and "no".

**Multi tenant was blocked at the front door, not in the data model.** Every
tenant scoped table already carried `user_id` (`records`, `tokens`, `devices`,
`invites`, `records_fts`), `rev_seq` was already per account, the realtime hub
already published per account, search already filtered by `user_id`, and
retention already swept `AllUserIDs()`. What stopped a second account from
existing was one check: `handleBootstrap` answered `409 already_bootstrapped`
as soon as `CountUsers() > 0`. So the isolation was proven, the way to create
the second tenant was missing.

**The stored data was unreachable outside the extension.** The server spoke
JSON and a WebSocket, nothing else: no way to ask "which tabverses does this
account have", "which devices are paired", "when did this token last work", or
"revoke that one, I lost the laptop". The only way to inspect a record was to
`sqlite3` the database file, and the only way to cut a leaked token was to
delete the `tabversed` process's data by hand.

**There was also an operational hole.** `TABVERSED_ADDR` defaults to
`0.0.0.0` and ADR 0002's answer to "what if the network can reach the pairing
endpoint" was *whoever pairs first owns the server*. That is a defensible
default for a personal server on a trusted LAN, and a bad one for anything
else - and there was no way to provision the *second* user of a shared server
without the database surgery above.

## Decision

**One admin token gates an operator surface; it never touches user data.**

1. **`TABVERSED_ADMIN_TOKEN` (optional) enables the admin API and the
   console.** Unset, every `/api/v1/admin/*` route answers `404` and the
   console's login screen says the deployment is single tenant. There is no
   half-enabled state to reason about, and a personal server keeps exactly the
   attack surface it had.

2. **Set, it makes the deployment multi tenant.** An operator creates accounts
   (`POST /api/v1/admin/users`), mints a pairing code for any of them, and
   `POST /api/v1/auth/bootstrap` stops being open to the network and requires
   the admin token instead. Accounts stay isolated by `user_id` - the property
   the schema already had, now reachable.

3. **The admin token is not a user token.** It resolves to no account: it is
   the operator of the deployment, and every admin handler takes the account
   it acts on explicitly (`user_id` in the path). A device token is rejected by
   the admin middleware and vice versa, and both tests are in the suite.

4. **The console is read only over user data.** It browses tabverses, tabs,
   notes, todos, bookmarks, closed tabs, raw records and search hits. There is
   no write path for records, and this is not an oversight to fill in later:
   a record written from here would carry no `device_id` and no trustworthy
   client clock, so the next honest sync from the real device would win the
   LWW comparison. The admin surface changes *operator* state instead -
   accounts, devices, tokens, pairing codes.

5. **Ordering stays the client's.** The console renders a tabverse the way the
   extension does: tabs by the tabverse's own `tabIds`, notes/todos/bookmarks
   by the `allnote` / `alltodo` / `allbookmark` aggregates, closed tabs by
   their own `closedAt`. The server reads those lists instead of re-deriving
   them, so the console cannot disagree with the browser about what the user's
   order is. A row no list mentions is still shown, after the listed ones.

6. **The console is three embedded files** (`internal/webui/assets/`: one
   HTML, one CSS, one JS, ~1200 lines total, no framework, no build step),
   served from the binary with a strict CSP. The extension's own UI is React
   and Blueprint, but it cannot be reused here: the console ships inside a Go
   binary with no bundler, and a build step for an operator page would be a
   worse trade than 1200 lines of vanilla JS.

## Consequences

- A shared server becomes a real thing to run: create an account, hand over a
  pairing code, watch what syncs, cut a device that went missing.
- A personal server is unchanged unless the operator opts in, and the startup
  log says so out loud when it listens on a non-loopback address.
- The admin API is a second, *bearer-token* surface over every account's data.
  It is guarded by one secret, compared in constant time, and the console
  keeps that secret in `localStorage` - the same trust model as ADR 0002's
  pairing codes, one level up. A deployment that must not have this surface
  simply does not set the variable.
- `GET /api/v1/admin/config` is the one unauthenticated admin route, and it
  only answers whether the admin API is on and which version is running.
- Deleting an account also deletes its `records_fts` rows, which the
  `ON DELETE CASCADE` foreign keys do not cover because FTS5 is a virtual
  table. There is a test for exactly that (`TestDeleteUserTakesItsSearchRows`).
- `tokens.last_used` is a new column, added by an idempotent migration, so the
  device list can say when a device was last seen. Telemetry only: a failed
  write never fails a request that is already authorized.
