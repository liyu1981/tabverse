# ADR 0027: user content lives in a per-user database

Status: **accepted (2026-10-11), always-on.** Extends
[ADR 0009](0009-multi-tenant-and-server-console.md) (multi-tenancy and the
console), follows [ADR 0001](0001-server-authoritative-sync.md) (the sync
protocol) and [ADR 0002](0002-privacy-posture.md) (privacy posture), and uses
the aggregation design of [ADR 0026](0026-cross-user-counters-are-eventually-consistent.md).
Plan: none - staged below.

## Context

Today the whole server is **one SQLite file**, isolated logically by `user_id`
(ADR 0009). The physical split was reviewed in
[`doc/tabversed-per-user-db-research.md`](../doc/tabversed-per-user-db-research.md)
and the decision is now **to build it**: we are building a hosted multi-tenant
service, so the bulk data wants hard per-tenant boundaries, a working set that
does not mix thousands of users' FTS pages, and a per-file unit for
encryption, backup, move and delete.

The boundary is the one the research doc settled on:

| Region | Contents |
| --- | --- |
| **Central file** (`TABVERSED_DB_PATH`) | `users`, `devices`, `tokens`, `invites`, `identities`, `email_tokens`, `verif_tokens`, `retired_subjects`, `server_secrets`, `audit_log`, and the counter cache of ADR 0026 |
| **Per-user file** | `records`, `records_fts`, `user_meta` (the per-user `rev_seq`) |

Account and auth data stays central and exact: `LookupToken`, revocation and
the account tables are on the authentication path, so a pairing or a revoke is
one indexed query and an immediate effect. `devices`/`tokens`/`invites` keep
their `REFERENCES users(id) ON DELETE CASCADE`; only `records` loses a
cross-file foreign key.

`rev_seq` moves *into* the user file even though it lives in `users` today. It
is the ordering key of the record stream and is written in the same transaction
as the record; split across stores, two pushes could commit out of order and a
client could advance past a revision that commits later. A copy may remain in
the central `users` row as the lag-tolerant display value of ADR 0026; the
authority is the one in the user file.

**There is no legacy data to migrate.** The only deployment is the author's, so
the migration is: point the server at a fresh data directory and re-sync from a
device. No single-file-to-files import path is built.

### The one collision, and what this proposes

ADR 0002 makes "single static binary, one file" a feature of self-hosting. This
splits the one file into a directory (a small central file plus one content
file per account). The posture is otherwise unchanged - still one binary, still
no external service, still a self-contained directory that can be copied - but
"one file" becomes "one directory". The alternative, an opt-in
(`TABVERSED_PER_USER_DB`) that keeps the single file as the default, is the
decision left open below; the recommendation is to make per-user content the
only content path, because two backends double the store's surface for a mode
only one deployment would use.

## Decision

Proposed, pending the mode answer:

1. **Boundary** as the table above: content per user, accounts and auth
   central, `rev_seq` in the user file.

2. **Layout.** The central file is `TABVERSED_DB_PATH`; user files live under
   `TABVERSED_USERS_DIR`, defaulting to a `users/` directory beside the central
   file. A user file is `<dir>/<user_id>.db`. `user_id` is server-minted
   (`usr_` + 32 hex), but the path is still validated (no separators) so a
   future id shape cannot escape the directory.

3. **Access is a bounded LRU pool.** `UserDBs` opens a content file on demand,
   one connection each (`SetMaxOpenConns(1)`), and caps the number of open
   files. The cap *is* the file-descriptor budget: a WAL database holds three
   descriptors (file, `-wal`, `-shm`), so `maxOpen` is chosen well below
   `RLIMIT_NOFILE` minus a socket reserve. Opening a new account evicts the
   least-recently-used **idle** handle and closes it, releasing its FDs; a
   handle in use by a request is never evicted.

4. **Backpressure.** When every slot is in use, `Acquire(ctx, id)` waits a
   bounded interval (default ~250 ms) for one to free, then returns
   `store.ErrBusy`. Handlers map `ErrBusy` to `503 Service Unavailable` with
   `Retry-After`; a real `EMFILE` maps to the same response. It never waits
   indefinitely, and the relay/sweep of ADR 0026 draws from the same pool at
   low priority so it cannot shed live sync.

5. **Account deletion.** The central delete still cascades devices, tokens and
   invites atomically; the content file is deleted separately, best-effort. A
   crash between the two leaves an orphan file, which the ADR 0026 worker
   removes (it also drops a counter row whose account is gone).

6. **Cross-user reads** (`ListUsers`, `Totals`) become a single central query
   against the ADR 0026 cache plus the live central device/token counts; they
   never open a user file for a tally. `SearchFor`, `ListRecords`,
   `ListTabspaces`, `GetTabspaceBundle` and `UserStats` are per account and open
   exactly one.

7. **Retention** keeps iterating accounts, opening each content file through
   the pool, pruning, releasing.

8. **Migrations are per file and lazy.** A content file is created on first
   access and its schema applied then, with the same idempotent
   `CREATE TABLE IF NOT EXISTS` approach as today; there is no central version
   table and none is added.

## Consequences

- The bulk data gets a real boundary: a corrupted, runaway or giant account
  stays in its file, and backup/move/delete/encrypt are per-file operations.
- Search (`records_fts`) and `rev_seq` stay with the records, so the sync
  protocol is unchanged in behavior; only *where* its two structures live
  changes.
- The FD budget is now an explicit number (`maxOpen`), and a burst is shed with
  a `503` the client already retries (single-flight `syncOnce`, outbox retained
  on failure). The cost is that a self-hoster now has a directory to back up
  rather than a file - an amendment to ADR 0002, not a new dependency.
- The store package grows a second handle type and a pool; the cross-user
  methods (`ListUsers`, `Totals`, `DeleteUser`, `SearchFor`, `ListDevices`)
  stop being one query and are rewritten explicitly. This is the work ADR 0026
  and the research doc anticipated.
- Nothing here requires a second engine: the files are still
  `modernc.org/sqlite`, and libSQL (research doc §4) is only a possible future
  for embedded replicas, not a dependency.

### Decisions taken during implementation

- **Mode:** always per-user content - one content code path. ADR 0002's "one
  file" becomes "one directory".
- **Config:** `TABVERSED_USERS_DIR` (default `users/` beside `TABVERSED_DB`) and
  `TABVERSED_MAX_OPEN_USER_DBS` (default 64, the FD budget).
- Still open: whether `user_meta` carries a schema version for future
  non-additive per-file migrations.
