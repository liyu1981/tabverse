# tabversed database: architecture and practice

Status: **reference (2026-10-11).** This describes the server's data layer as
built. It records no new decisions - those live in the ADRs it cites (0001 sync,
0002 privacy, 0009 multi-tenant, 0011 archiving, 0012 accounts, 0026 counters,
0027 per-user content) - and it is the place to look before changing
`server/internal/store/`.

- §1 the shape
- §2 the engine and the connections
- §3 the schema
- §4 the sync model (`records`)
- §5 full-text search
- §6 accounts, identity and credentials
- §7 archiving vs deleting
- §8 retention
- §9 the cross-user counter cache
- §10 concurrency, the pool and backpressure
- §11 multi-tenancy
- §12 migrations
- §13 testing practice
- §14 operations

---

## 1. The shape

Two kinds of SQLite file (ADR 0027):

- **The central file** at `TABVERSED_DB` (default `data/tabversed.db`): accounts,
  devices, tokens, invites, the account tables, and the counter cache.
- **One content file per account** under `TABVERSED_USERS_DIR` (default `users/`
  beside the central file, i.e. `data/users/<user_id>.db`): `records`,
  `records_fts`, and the account's `user_meta` (its `rev_seq`).

`serve.go` opens the whole bundle once (`store.Open`) and hands the same
`*store.Store` to the API, the realtime hub, the retention loop and the counter
relay. `Store` owns the central `*sql.DB` and a bounded pool of open content
files (`UserDBs`); content methods take an explicit `userID`, acquire that
account's file, and run there. There is no cross-file transaction: account and
auth data is central and exact, content is per account and isolated.

The driver is `modernc.org/sqlite`, the **pure Go** SQLite (no cgo), chosen so
the server cross-compiles to a static binary for every target
(`server/internal/store/store.go`). FTS5 is compiled into it, which is what
makes `records_fts` possible with no extension to ship.

## 2. The engine and the connections

Every file - central and content - is opened with the same pragmas and one
connection:

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
| `foreign_keys(1)` | cascades are real (central `ON DELETE CASCADE` from `users`) |

**One connection per file is the design, not a default.** SQLite has a single
writer anyway; serializing connections means the deferred read-then-write
transactions the sync path uses (see §4) cannot hit `SQLITE_BUSY`, and every
query path releases its rows before issuing the next statement so a single
connection cannot self-deadlock. WAL still lets the OS serve concurrent readers
at the filesystem level.

The **file-descriptor budget** is now explicit. A WAL file holds three
descriptors while open (the file, its `-wal` and its `-shm`), so the pool caps
how many content files are open at once (`TABVERSED_MAX_OPEN_USER_DBS`, default
64) and evicts the least-recently-used idle one when it needs room. The cap
should stay well below `RLIMIT_NOFILE` minus the socket reserve; on a large
deployment raise the OS limit and the cap together.

## 3. The schema

**Central** (`migrate()` in `store.go`):

| Table | Key | Notes |
| --- | --- | --- |
| `users` | `id` | login, role, `tokens_valid_after` (no `rev_seq` - it moved per user) |
| `devices` | `id` | one row per paired device |
| `tokens` | `hash` | device tokens; only the hash is stored |
| `invites` | `code_hash` | single-use pairing codes |
| `identities` | `(provider, subject)` | one row per external login (ADR 0012) |
| `email_tokens` | `(purpose, token_hash)` | verify / reset links, single use |
| `verif_tokens` | `token_hash` | redeemed sign-in links, survives restart |
| `retired_subjects` | `(provider, subject)` | a deleted account's subjects |
| `audit_log` | `id` | who did what, never pruned |
| `server_secrets` | `name` | values minted on first boot |
| `user_counters` | `user_id` | the ADR 0026 cache, §9 |
| `counter_dirty` | `user_id` | accounts whose counters are stale |
| `user_entity_counts` | `(user_id, entity)` | per-entity live counts for the cache |

Indexes: `devices_user`, `tokens_user`, `identities_user`,
`email_tokens_hash`, `verif_tokens_expiry`, `audit_log_at(at DESC)`, and
`users_email` as a partial **unique** index where `email IS NOT NULL`.

**Per account** (`UserDB.migrate`, `userdb.go`):

| Table | Key | Notes |
| --- | --- | --- |
| `records` | `(user_id, entity, id)` | the sync source of truth, §4 |
| `records_fts` | virtual (FTS5) | the search index, §5 |
| `user_meta` | `user_id` | the account's `rev_seq` |

Indexes: `records_user_rev(user_id, rev)`, `records_archived(user_id,
archived_at)`. `user_id` is kept in every key even though a file holds exactly
one account, so the SQL paths stay the ones the sync protocol proved.

**`rev_seq` lives in `user_meta`, beside the records it numbers.** It is the
per-user revision counter - the sequence that makes delta sync possible without
a global clock (§4) - and it is written in the same transaction as the record,
which a cross-file counter could not be.

## 4. The sync model (`records`)

The client is authoritative for content; the server is authoritative for
**order**. One row per `(user_id, entity, id)`, in the account's own file:

- **`rev`** is per-user and monotonic. `nextRev` bumps `user_meta.rev_seq` inside
  the content transaction and returns the new value. It is the delta cursor: a
  client pulls `rev > since` and gets everything it missed, oldest first
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

`ApplyRecords` is the single write path, one transaction for the whole batch in
that account's file, and it maintains `records_fts` in the same transaction
(§5). The entity set is **closed** (`Entities` in `models.go`): `tabspace`,
`tab`, `session`, `note`, `todo`, `bookmark`, `closedtab`, and the
`allnote`/`alltodo`/`allbookmark` ordering aggregates. The API validates against
it.

## 5. Full-text search

`records_fts` is a standalone FTS5 table (`entity`, `user_id`, `record_id`
UNINDEXED, `body`, `tokenize = 'unicode61 remove_diacritics 2'`) in each
account's file. It is not content-linked to `records`; it is written by hand,
**inside the caller's transaction**, by `ftsReplace`:

1. delete the row for `(user_id, entity, record_id)`;
2. if the record is deleted, empty, or of a non-indexed entity, stop;
3. otherwise insert the derived body.

`ftsBody` concatenates every JSON **string** in the payload - titles, urls, tags,
note bodies - which is what a tab manager user expects to be searchable, while
skipping identifier keys (`id`, `tabSpaceId`, `version`, and the id-list
aggregates) so a search cannot match every record hanging off a tabverse. The
indexed entity set excludes the aggregates (`IndexedEntities`).

Queries (`Search`, `SearchFor`) never pass user input through raw: every
whitespace-separated term is quoted (embedded quotes doubled) and the last term
gets a trailing `*` for as-you-type matching (`buildMatchExpr`). `bm25` is
negated so a higher score is a better hit, and every hit is resolved to its
**tabverse id** (`tabspaceIDOf`) so the client can filter against what it has
locally. Search is always scoped by `user_id`, and now also by file: it opens
exactly one account.

FTS5 is a virtual table, so `ON DELETE CASCADE` does **not** cover it. Account
deletion no longer deletes FTS rows in a transaction; it deletes the whole
content file (§7), which takes `records_fts` with it.

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
fingerprint. Token lookup and revocation are central and exact - they are on the
authentication path, and the per-user split deliberately leaves them there
(ADR 0027). **Pairing invites** are single-use and expiring, consumed atomically
in a transaction (`ConsumeInvite`). **`server_secrets`** holds values minted on
first boot (e.g. the session signing key) so a self-hosted deployment works with
no configuration.

## 7. Archiving vs deleting

Two different acts, deliberately not conflated (ADR 0011, `archive.go`):

- **Archiving** (`archived_at`) is **operator bookkeeping and nothing else.** The
  row stays, keeps syncing to the user's devices, and the user's extension never
  sees the flag - only the console hides archived rows, reversibly. A record
  edited again un-archives itself, because it is live again. Device and token
  archiving is central; record archiving runs in the account's file.
- **Deleting an account** (`DeleteUser`) is the real removal: one central
  statement deletes the `users` row, whose `ON DELETE CASCADE` takes `devices`,
  `tokens`, `invites`, `identities`, `email_tokens` and the counter rows; then
  the content file is deleted separately. A crash between the two leaves an
  orphan file, which the counter relay's sweep reaps (§9). Because the two
  stores cannot share a transaction, this is best-effort rather than atomic, and
  the sweep is what makes it eventually complete.

An operator cannot archive a still-live token or a device whose tokens still
authenticate (`ErrNotRevoked`): revoking is how access is cut, archiving is how a
dead credential is tidied away.

## 8. Retention

Server-side retention (`internal/retention/`) exists only for the `session`
entity - the periodic window snapshots older clients wrote. It walks
`AllUserIDs()` and, for each account, opens the content file through the pool,
then `PruneOlderThan` **tombstones** rows older than the cutoff (never
hard-deletes), so the removal propagates to clients through delta sync like any
other change, and publishes a `records_changed` hub message so open clients pull.

It runs at startup and then on a 6-hour ticker (1 hour when the window is a
single day); `TABVERSED_RETENTION_DAYS=0` disables it entirely. Only `session` is
in `PrunableEntities`. Because it opens one file at a time, it cannot exhaust the
descriptor budget, but it does compete with live sync for pool slots.

## 9. The cross-user counter cache

The console's cross-user reads (`ListUsers`, `Totals`) need per-account record
tallies - counts, tombstone counts, last activity, per-entity totals. Reading
them from the content files on every console request would fan out over N files.
ADR 0026 instead makes them **eventually consistent**:

- **Exact values stay live and central.** Device and token counts, and
  `rev_seq` (from the account's file, where it is authoritative), are not cached.
  Token lookup and revocation are always exact.
- **Derived counters are cached** in `user_counters` / `user_entity_counts` and
  may lag. `ListUsers` and `Totals` are therefore a single central query that
  never opens a content file.
- **Content writes mark the account dirty.** `ApplyRecords`, `PruneOlderThan`
  and record archive/unarchive upsert `counter_dirty(user_id, at)`
  best-effort after their transaction commits.
- **A relay recomputes, it does not apply deltas.** `internal/counters` drains
  dirty accounts on a one-minute tick, recomputing each from its file
  (`COUNT(*)`, `MAX(updated_at)`, the per-entity group) and upserting the cache.
  Recompute-and-upsert is idempotent and self-healing; there is no delta
  bookkeeping to drift. A marker that arrives during a recompute survives
  (cleared only up to the read's start), so the account is recomputed again.
- **A full sweep is the net.** Every 15 ticks the relay recomputes every account
  and reaps orphan content files, healing any lost marker and any interrupted
  account deletion. It also runs once at startup, so a fresh process rebuilds an
  empty cache before the console is read.

Device/token/account numbers on the console are exact; record-derived numbers
may be up to about a tick behind. That is acceptable because they are display
only, and the relay is the price of keeping the request path O(1) in the number
of accounts.

## 10. Concurrency, the pool and backpressure

- **One writer per file, serialized** by that file's single connection (§2). The
  central writer and each account's writer are independent, so different
  accounts' content writes proceed in parallel - the reason the split exists.
- **A transaction whenever more than one statement must agree**, within one
  file. Examples: `ApplyRecords` (batch + FTS + rev), `ConsumeInvite`
  (check-and-mark), `MarkVerifTokenUsed` (redeem-once), `nextRev` (bump-and-read,
  *must* be inside a transaction).
- **There is no cross-file transaction.** Where two files are involved
  (`DeleteUser`, the counter recompute), the operation is made eventual by a
  sweep rather than atomic.
- **The pool is bounded and sheds.** `UserDBs` caps open content files at
  `TABVERSED_MAX_OPEN_USER_DBS` and is an LRU: opening a new account evicts the
  least-recently-used idle handle (closing it releases its three descriptors);
  a handle in use by a request is never evicted. When every slot is in use,
  `Acquire` waits a bounded interval (default 250 ms) and then returns
  `store.ErrBusy`, which the API maps to `503 + Retry-After`. `EMFILE`/`ENFILE`
  map to the same response. It never waits indefinitely: an unbounded queue
  would move descriptor exhaustion into sockets and goroutines.
- **The relay is low-priority.** It draws from the same pool in bounded batches
  and gives up (rather than blocking) when the pool is busy, so it cannot shed
  live sync.

## 11. Multi-tenancy

Isolation is now **physical**: account and auth rows in the central file, each
account's content in its own file (ADR 0027). The logical property was already
there (ADR 0009) - every tenant table carried `user_id`, search filtered by it,
the hub published per account, retention swept `AllUserIDs()` - and the physical
split makes the boundary real for the bulk data, so backup, move, encrypt and
delete are per-account operations, and one account's corruption or runaway
query stays in its file. The auth-critical tables stay central on purpose: they
are a cheap indexed lookup on every request, and moving them would add a hop
without adding isolation.

## 12. Migrations

Two migrations, both idempotent and additive:

- **Central** (`migrate()` in `store.go`) runs at every `Open`:
  `CREATE TABLE IF NOT EXISTS`, additive columns via `ALTER TABLE ADD COLUMN`
  (`addColumn`), and `CREATE INDEX IF NOT EXISTS`.
- **Per account** (`UserDB.migrate`) runs lazily when a content file is first
  opened. There is no version table and no `user_version`; a fresh file gets the
  full schema and an existing one keeps its rows.

Everything ever added is an additive column (`tokens.last_used`,
`tokens.archived_at`, `devices.archived_at`, `records.archived_at`,
`users.email`, `users.email_verified_at`, `users.password_hash`, `users.role`,
`users.disabled_at`, `users.tokens_valid_after`). **There are no destructive
migrations**, and an existing deployment upgrades by starting the new binary. A
new column must be additive and defaulted; anything else needs a deliberate
plan, not a migration line.

## 13. Testing practice

Tests open **real** SQLite files in `t.TempDir()` (`newTestStore`), not fakes, so
the schema, FTS5, cascades, transactions and the per-user files under test are
the ones that ship. The suite runs under `-race` (`pnpm run server:test-race`).
Coverage includes the invariants this document is about: LWW rejection and
idempotent replay, tombstone pruning, FTS maintenance, per-user persistence
across a pool reopen, LRU eviction and busy backpressure, the counter drain and
orphan sweep, account deletion and its content-file removal, archive/unarchive,
token lookup, and session revocation.

Because counters are eventually consistent, a test that reads `Totals` or
`ListUsers` right after a write must run `RecomputeAllCounters` first, exactly as
the relay would.

## 14. Operations

- **Paths:** the central file at `TABVERSED_DB` (default `data/tabversed.db`);
  content files under `TABVERSED_USERS_DIR` (default `users/` beside it,
  `data/users/`). Both directories are created at startup.
- **Backup:** copy the central file **and** the `users/` directory (with their
  `-wal`/`-shm` alongside, or after a clean shutdown). It is a directory, not a
  file, now.
- **Descriptors:** budget for roughly `3 × TABVERSED_MAX_OPEN_USER_DBS` plus one
  per connection, and keep `RLIMIT_NOFILE` above that with headroom.
- **Build:** `CGO_ENABLED=0` static binary; the driver needs no cgo, so there is
  nothing to install on the host.
- **Scaling shape:** one process, a small central file and a directory of content
  files. The counter relay keeps console reads O(1); the way to more capacity is
  a bigger box, a higher pool cap, or sharding the content files across hosts -
  not a second engine.
