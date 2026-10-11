# tabversed database: architecture and practice

Status: **reference (2026-10-11).** This describes the server's data layer as
built. It records no new decisions - those live in the ADRs it cites (0001 sync,
0002 privacy, 0009 multi-tenant, 0011 archiving, 0012 accounts) - and it is the
place to look before changing `server/internal/store/`.

- §1 the shape
- §2 the engine and the one connection
- §3 the schema
- §4 the sync model (`records`)
- §5 full-text search
- §6 accounts, identity and credentials
- §7 archiving vs deleting
- §8 retention
- §9 concurrency and transactions
- §10 multi-tenancy
- §11 migrations
- §12 testing practice
- §13 operations

---

## 1. The shape

One SQLite database file per deployment, at `TABVERSED_DB` (default
`data/tabversed.db`; `server/internal/config/config.go`). `serve.go` opens it
once (`store.Open`) and hands the same `*store.Store` to the API, the realtime
hub and the retention loop. There is no second store, no cache layer, no
migration service: the process and the file are the whole data tier.

The driver is `modernc.org/sqlite`, the **pure Go** SQLite (no cgo), chosen so
the server cross-compiles to a static binary for every target
(`server/internal/store/store.go`). FTS5 is compiled into it, which is what
makes `records_fts` possible with no extension to ship.

## 2. The engine and the one connection

```go
dsn := "file:<path>?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)"
db.SetMaxOpenConns(1)
db.SetMaxIdleConns(1)
db.SetConnMaxLifetime(time.Hour)
```

The pragmas are deliberate:

| Pragma | Why |
| --- | --- |
| `journal_mode(WAL)` | readers do not block the writer, and a crash does not corrupt |
| `busy_timeout(5000)` | a blocked writer waits rather than failing immediately |
| `foreign_keys(1)` | cascades are real (`ON DELETE CASCADE` from `users`) |

**One connection is the design, not a default.** SQLite has a single writer
anyway; serializing connections means the deferred read-then-write transactions
the sync path uses (see §4) cannot hit `SQLITE_BUSY`, and every query path
releases its rows before issuing the next statement so a single connection
cannot self-deadlock. WAL still lets the OS serve concurrent readers at the
filesystem level if the deployment ever grows.

Privacy posture (ADR 0002): plaintext at rest, TLS in transit, one file an
operator can put on an encrypted volume. Backup is a file copy.

## 3. The schema

Everything is created by `migrate()` in `store.go`. Two groups of tables:

**Tenant data** (scoped by `user_id`):

| Table | Key | Notes |
| --- | --- | --- |
| `records` | `(user_id, entity, id)` | the sync source of truth, §4 |
| `records_fts` | virtual (FTS5) | the search index, §5 |
| `devices` | `id` | one row per paired device |
| `tokens` | `hash` | device tokens; only the hash is stored |
| `invites` | `code_hash` | single-use pairing codes |

**Accounts and server state:**

| Table | Key | Notes |
| --- | --- | --- |
| `users` | `id` | login, role, `rev_seq`, `tokens_valid_after` |
| `identities` | `(provider, subject)` | one row per external login (ADR 0012) |
| `email_tokens` | `(purpose, token_hash)` | verify / reset links, single use |
| `verif_tokens` | `token_hash` | redeemed sign-in links, survives restart |
| `retired_subjects` | `(provider, subject)` | a deleted account's subjects |
| `audit_log` | `id` | who did what, never pruned |
| `server_secrets` | `name` | values minted on first boot |

Indexes: `devices_user`, `tokens_user`, `records_user_rev(user_id, rev)`,
`records_archived(user_id, archived_at)`, `identities_user`,
`email_tokens_hash`, `verif_tokens_expiry`, `audit_log_at(at DESC)`, and
`users_email` as a partial **unique** index where `email IS NOT NULL`.

`users.rev_seq` is the per-user revision counter - the sequence that makes delta
sync possible without a global clock (§4).

## 4. The sync model (`records`)

The client is authoritative for content; the server is authoritative for
**order**. One row per `(user_id, entity, id)`:

- **`rev`** is per-user and monotonic. `nextRev` bumps `users.rev_seq` inside
  the transaction and returns the new value. It is the delta cursor: a client
  pulls `rev > since` and gets everything it missed, oldest first
  (`PullRecords`, with a `limit+1` peek for `hasMore`).
- **`updated_at`** is the client's clock (unix ms). Conflict resolution is
  **last-writer-wins on `updated_at`**: an incoming record older than the stored
  one is rejected with `StatusStale` and the current server copy attached, so
  the client merges without another round trip.
- **Replays are idempotent.** An input with the same `updated_at`, `deleted` and
  `payload` is accepted with the existing `rev` and consumes no new revision -
  a retry after a lost response does not churn the sequence.
- **Deletes are tombstones** (`deleted = 1`, `payload = ''`), so every client
  learns about a removal through the normal delta sync. Nothing is hard-deleted
  by a sync.
- An accepted write clears `archived_at` (a record just changed is live again,
  §7).

`ApplyRecords` is the single write path, one transaction for the whole batch,
and it maintains `records_fts` in the same transaction (§5). The entity set is
**closed** (`Entities` in `models.go`): `tabspace`, `tab`, `session`, `note`,
`todo`, `bookmark`, `closedtab`, and the `allnote`/`alltodo`/`allbookmark`
ordering aggregates. The API validates against it.

## 5. Full-text search

`records_fts` is a standalone FTS5 table (`entity`, `user_id`, `record_id`
UNINDEXED, `body`, `tokenize = 'unicode61 remove_diacritics 2'`). It is not
content-linked to `records`; it is written by hand, **inside the caller's
transaction**, by `ftsReplace`:

1. delete the row for `(user_id, entity, record_id)`;
2. if the record is deleted, empty, or of a non-indexed entity, stop;
3. otherwise insert the derived body.

`ftsBody` concatenates every JSON **string** in the payload - titles, urls, tags,
note bodies - which is what a tab manager user expects to be searchable, while
skipping identifier keys (`id`, `tabSpaceId`, `version`, and the id-list
aggregates) so a search cannot match every record hanging off a tabverse. The
indexed entity set excludes the aggregates (`IndexedEntities`).

Queries (`Search`) never pass user input through raw: every whitespace-separated
term is quoted (embedded quotes doubled) and the last term gets a trailing `*`
for as-you-type matching (`buildMatchExpr`). `bm25` is negated so a higher score
is a better hit, and every hit is resolved to its **tabverse id**
(`tabspaceIDOf`) so the client can filter against what it has locally. Search is
always scoped by `user_id`.

FTS5 is a virtual table, so `ON DELETE CASCADE` does **not** cover it: deleting
an account deletes its `records_fts` rows explicitly in the same transaction
(`DeleteUser`), and there is a test for exactly that.

## 6. Accounts, identity and credentials

The account layer exists for the web console; device tokens are unchanged - a
device is paired, never logged in (ADR 0012). Three ideas are kept apart:

- `users.email` / `password_hash` - the login a person types;
- `identities` - one row per external login (`github`, `google`, ...);
- `audit_log` - who did what, including every impersonation.

**There is no session table.** The console session is a JWT in a cookie, so
revocation is `users.tokens_valid_after`, a cut-off that invalidates everything
issued before it ("sign out everywhere", revoke-on-password-change).

Two small tables carry guarantees that would otherwise die with the process:

- `verif_tokens` makes "this link works once" true **across a restart and across
  replicas** (an in-memory default would not); `SweepVerifTokens` drops rows
  older than a day.
- `retired_subjects` remembers the external subjects of a deleted account, so a
  stale session cannot silently recreate the account on its next request.

**Device tokens are stored as hashes** (`tokens.hash`), looked up with
`revoked = 0`; the raw token is never stored, so the console can only show a
fingerprint. **Pairing invites** are single-use and expiring, consumed
atomically in a transaction (`ConsumeInvite`). **`server_secrets`** holds values
minted on first boot (e.g. the session signing key) so a self-hosted deployment
works with no configuration.

## 7. Archiving vs deleting

Two different acts, deliberately not conflated (ADR 0011, `archive.go`):

- **Archiving** (`archived_at`) is **operator bookkeeping and nothing else.** The
  row stays, keeps syncing to the user's devices, and the user's extension never
  sees the flag - only the console hides archived rows, reversibly. A record
  edited again un-archives itself, because it is live again.
- **Deleting an account** (`DeleteUser`) is the real removal: FTS rows deleted by
  hand, then the `users` row, whose `ON DELETE CASCADE` takes `records`,
  `devices`, `tokens`, `invites`, `identities`, `email_tokens`.

An operator cannot archive a still-live token or a device whose tokens still
authenticate (`ErrNotRevoked`): revoking is how access is cut, archiving is how a
dead credential is tidied away.

## 8. Retention

Server-side retention (`internal/retention/`) exists only for the `session`
entity - the periodic window snapshots older clients wrote. `PruneOlderThan`
**tombstones** rows older than the cutoff (never hard-deletes), so the removal
propagates to clients through delta sync like any other change, and publishes a
`records_changed` hub message so open clients pull.

It runs at startup and then on a 6-hour ticker (1 hour when the window is a
single day); `TABVERSED_RETENTION_DAYS=0` disables it entirely. Only `session` is
in `PrunableEntities`.

## 9. Concurrency and transactions

- **One writer, serialized** by the single connection (§2). No lock contention to
  reason about, no `SQLITE_BUSY` retries in application code.
- **A transaction whenever more than one statement must agree.** Examples:
  `ApplyRecords` (batch + FTS + rev), `ConsumeInvite` (check-and-mark),
  `DeleteUser` (FTS + cascade), `MarkVerifTokenUsed` (redeem-once),
  `nextRev` (bump-and-read, *must* be inside a transaction).
- **Read-then-write is safe** precisely because the connection is single and the
  code releases rows before the next statement.
- There is no `ATTACH`, no cross-database transaction, and no second file to keep
  consistent - the whole data tier is one file.

## 10. Multi-tenancy

Isolation is **logical, by `user_id`**, over one shared file (ADR 0009): every
tenant table carries `user_id`, `rev_seq` is per user, search filters by
`user_id`, the hub publishes per account, and retention sweeps
`AllUserIDs()`. The property was designed in from the start; accounts are what
made it reachable.

The alternative - a database per user - was reviewed and **not adopted**; the
review, the trade-offs and the Turso research are in
`doc/tabversed-per-user-db-research.md`. Read that before proposing a physical
split.

## 11. Migrations

There is no version table and no `user_version`. `migrate()` runs at every
`Open` and is **idempotent and additive**:

1. `CREATE TABLE IF NOT EXISTS` / `CREATE VIRTUAL TABLE IF NOT EXISTS` for every
   table, in one transaction;
2. additive columns via `ALTER TABLE ADD COLUMN`, where a "duplicate column
   name" error is the expected no-op (`addColumn`);
3. `CREATE INDEX IF NOT EXISTS`.

Everything ever added is an additive column (`tokens.last_used`,
`tokens.archived_at`, `devices.archived_at`, `records.archived_at`,
`users.email`, `users.email_verified_at`, `users.password_hash`, `users.role`,
`users.disabled_at`, `users.tokens_valid_after`). **There are no destructive
migrations**, and an existing deployment upgrades by starting the new binary.
A new column must be additive and defaulted; anything else needs a deliberate
plan, not a migration line.

## 12. Testing practice

Tests open a **real** SQLite file in `t.TempDir()` (`newTestStore`), not a fake,
so the schema, FTS5, cascades and transactions under test are the ones that ship.
The suite runs under `-race` (`pnpm run server:test-race`). Coverage includes the
invariants this document is about: LWW rejection and idempotent replay, tombstone
pruning, FTS maintenance, the account-delete cascade that also clears
`records_fts`, archive/unarchive, token lookup, and session revocation.

## 13. Operations

- **Path:** `TABVERSED_DB`, default `data/tabversed.db`; the parent directory is
  created at startup.
- **Backup:** copy the database file (with its `-wal`/`-shm` alongside, or after
  a clean shutdown). One file, no external state.
- **Build:** `CGO_ENABLED=0` static binary; the driver needs no cgo, so there is
  nothing to install on the host.
- **Scaling shape:** one process, one file. The way to more capacity is a bigger
  box or a reviewed physical split (`doc/tabversed-per-user-db-research.md`), not
  a second engine.
