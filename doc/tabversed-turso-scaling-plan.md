# Plan: a Turso cloud path that keeps the community SQLite app

Status: **proposal, for review (2026-10-11).** No code. This is our answer to
the Gemini plan (`turso_scaling_plan.md`): what is right, what is wrong, and
what I would actually build. Decisions that come out of the review belong in an
ADR before `server/internal/store/` is touched.

Read with `doc/tabversed-database-architecture.md` (the current data layer) and
`doc/tabversed-per-user-db-research.md` (the physical-split review).

- §1 the goal and the constraint
- §2 what Gemini got right
- §3 what is wrong or risky (with evidence)
- §4 our plan, staged
- §5 spikes to run first
- §6 decisions I need from you
- §7 what we are not doing

---

## 1. The goal and the constraint

Two deployments, one codebase:

- **Community:** one static binary, one SQLite file, zero configuration. This is
  ADR 0002's recommendation and must not regress.
- **SaaS:** the same binary pointed at a hosted database, so one operator can
  serve many accounts without hand-running SQLite.

The constraint that shapes everything: **pure Go, no cgo**, so the binary keeps
cross-compiling. That rules out the one Turso driver that does local embedded
replicas (`go-libsql` needs cgo).

## 2. What Gemini got right

- **The seam is the right one.** Branch on the connection string; the `*sql.DB`
  in `store.Store` is already engine-agnostic, so the store methods do not have
  to change to point at a remote database.
- **Local mode keeps its pragmas and its single connection; remote mode does
  not use them.** Correct: `journal_mode` and `busy_timeout` are not supported
  on Turso Cloud (they are server-managed), while they are exactly what local
  SQLite needs.
- **Schema, FTS hooks and additive migrations are portable.** `libSQL` is a
  SQLite fork and does support FTS5 and `RETURNING`, so the `records_fts`
  lifecycle and the migration loop do not need rewriting *for libSQL* (see §3.3
  for the engine caveat).
- **No lock-in.** A libSQL database is a standard SQLite file; a backup drops
  back into a self-hosted instance unchanged. True and worth protecting.
- **Tests keep using a local file.** `t.TempDir()` down to `Open` stays the
  default; the cloud path is exercised separately (§5).

## 3. What is wrong or risky

### 3.1 The auth token in the DSN is rejected (or silently dropped)

Gemini builds `fmt.Sprintf("%s?authToken=%s", url, token)`. The driver refuses
tokens in the URL and wants the option instead:

> `libsql/sql.go`: `if query.Has("auth_token") { return ... "'auth_token' usage
> forbidden. Please use 'WithAuthToken' option instead" }`

`authToken` (camelCase) slips past that specific check and is then just an
unknown query parameter, so the token is not sent and every remote request
fails auth. The correct call is:

```go
connector, err := libsql.NewConnector(url, libsql.WithAuthToken(token))
db := sql.OpenDB(connector)
```

Passing a bearer token through a string that gets logged and echoed in errors is
also the wrong habit regardless.

### 3.2 "Unified driver" is a mirage: `file:` delegates back to modernc

Gemini says we *replace* `modernc.org/sqlite` with `libsql-client-go`. We do not;
for a local path the libsql driver **looks for and delegates to** an embedded
SQLite driver:

> `libsql/sql.go`: for a `file:` URL it scans `sql.Drivers()` for `"sqlite"` or
> `"sqlite3"` and `sql.Open`s that, or fails with *"no sqlite driver present"*.

So modernc stays a dependency either way, and the community path gains nothing
from being routed through the libsql driver - it only adds an indirection, a
`file://`-vs-`file:` quirk (double-slash URLs are rejected), and a second way to
configure pragmas. The community path should keep opening `sqlite` directly.

### 3.3 libSQL is single-writer; MVCC and `BEGIN CONCURRENT` are Turso *Database*

The plan's diagram says "Turso Cloud Cluster - Multi-Writer MVCC" and §3 leans
on `BEGIN CONCURRENT`, but `libsql-client-go` talks to **libSQL**, the SQLite
fork, which is single-writer WAL. Concurrent writes / MVCC is a **Turso
Database** (`tursodb`, the Rust rewrite) feature, reached over HTTP by
`tursogo-serverless`, and its full-text search is **Tantivy, not FTS5** - so
choosing it means rewriting `records_fts` and its queries. The plan mixes the
two products and picks a driver from one while claiming the concurrency of the
other.

### 3.4 The concurrency fix is incomplete, and the pool size is unsafe

This is the one that would bite in production. The current single connection is
not just a performance choice - it is what makes the **read-then-write** LWW
check in `ApplyRecords` safe:

```go
cur, _ := getRecordTx(...)        // read
if cur.UpdatedAt > in.UpdatedAt { // decide
    ... stale ...
}
// ... else INSERT ... ON CONFLICT DO UPDATE
```

Gemini raises `MaxOpenConns` to 32 for remote and only fixes `nextRev` with
`RETURNING`. But `nextRev` was never the race - the **record comparison** is.
Two connections can both read the old row, both pass the LWW test, and both
write; the sequence breaks and a newer edit can be clobbered, or one transaction
fails with a lock/conflict the code does not retry. Raising the pool without
making the decision atomic re-introduces exactly the bug `SetMaxOpenConns(1)`
was there to prevent.

Two honest ways forward, and the plan must pick one (§6):

- **A. Keep one connection for remote too.** Correct by construction, no store
  changes, throughput limited to one in-flight query per process. Fine until a
  measured queue, and it is the low-risk first release.
- **B. Make the LWW decision atomic in SQL**, then a pool is safe. A conditional
  upsert such as
  `INSERT ... ON CONFLICT ... DO UPDATE SET ... WHERE excluded.updated_at >
  records.updated_at` plus a `RETURNING`/follow-up read for the `stale` reply.
  More work, more tests, and it changes the sync hot path - it should be its own
  reviewed change, not a line in a driver swap.

### 3.5 `ON DELETE CASCADE` may not fire on the remote

`DeleteUser` relies on `users` cascading to `records`, `devices`, `tokens`,
`invites`, `identities`, `email_tokens`. That works locally because the DSN sets
`foreign_keys(1)`. On a managed server we cannot assume that pragma is on (it is
off by default in SQLite, and Turso Cloud does not let a client set
`journal_mode`/`busy_timeout`), and the plan never checks. If FK enforcement is
off, deleting an account leaves orphaned tenant rows on the cloud. The portable
fix is to delete the children explicitly in `DeleteUser` (it already deletes
`records_fts` by hand for the same reason) and stop depending on the cascade.

### 3.6 Local and remote run different code paths, so tests stop predicting prod

With the branch in §2, local is modernc/single-connection/WAL and remote is
libSQL/pool/no-pragmas. The current suite only ever exercises the first. The
plan's "identical testing footprint" checkbox is only true if we also run the
suite against a **local libSQL server** (§5); otherwise the path we ship to
paying users is the path nobody tested.

### 3.7 Smaller things

- `Open(databaseURL, authToken)` pushes a credential into the store
  constructor and changes every call site (including tests). A small options
  struct (or building the connector in `serve.go`) keeps `store` about storage.
- Running `migrate()` on every process start over the network is fine while it
  is idempotent, but with several replicas it is concurrent DDL; keep the
  additive `duplicate column` tolerance and expect it.
- "The driver automatically batches statements in a transaction" is optimistic:
  the HTTP connector sends per-statement requests; pipelining is a WebSocket
  (Hrana) property. Do not design latency around an assumed batch.

## 4. Our plan, staged

The shape: **one store, two openers.** Keep the community path byte-for-byte
what it is today; add a remote opener behind the same `*sql.DB`.

**Stage 0 - decide and spike (no product code).** Run §5. Write the ADR with
the chosen engine, the concurrency answer (A or B), and the delete strategy.

**Stage 1 - the opener seam.** `store.Open` becomes scheme-aware:
- `libsql://`, `https://`, `wss://` → `sql.OpenDB(libsql.NewConnector(url,
  libsql.WithAuthToken(token)))`, pool size per the §6 decision, **no** local
  pragmas;
- anything else → the current `sql.Open("sqlite", "file:...?_pragma=...")` with
  `SetMaxOpenConns(1)`, unchanged.

Config: `TABVERSED_DB` stays; add `TABVERSED_DB_AUTH_TOKEN`. The auth token is
never logged.

**Stage 2 - correctness for the remote path.** Whichever §6 answer: if A, the
remote opener also uses one connection and there is nothing else to do; if B,
rewrite `ApplyRecords`'s LWW step to be atomic and add concurrency tests. Make
`DeleteUser` delete children explicitly (drop the cascade dependency) either
way, because it is portable and cheap.

**Stage 3 - prove parity.** Run the store suite against a local `sqld`/libSQL
server in CI (Docker), so the remote opener and the SQL both get exercised
without Turso Cloud credentials.

**Stage 4 - the actual scaling lever, if needed.** A single libSQL database is
still one writer. When one box is the bottleneck, the lever is more databases,
not a bigger pool: read replicas, or the per-user/sharded model already reviewed
in `doc/tabversed-per-user-db-research.md`. Turso Cloud's per-tenant fleet is
the natural fit for that, but it is a separate project.

## 5. Spikes to run first

All bounded, all answerable in an afternoon:

1. **FTS5 parity on the chosen engine.** Create `records_fts` on a local
   `sqld`/Turso Cloud database, index a record, and run the real `Search` query
   (`MATCH`, `bm25`, `snippet`, the join). Confirm it returns what the local
   file does. (This is a pass for libSQL, and the reason to avoid Turso
   Database unless we accept a Tantivy rewrite.)
2. **Foreign keys.** On the chosen engine, create a parent/child with
   `ON DELETE CASCADE`, delete the parent, and see whether the child goes. If
   not, §3.5's explicit delete is mandatory.
3. **`RETURNING` and the atomic upsert.** Confirm
   `UPDATE ... RETURNING` and the conditional
   `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE` both work, so the §6-B path
   is viable.
4. **Latency profile.** Point a copy of the server at a local libSQL server and
   measure the current query patterns - `ApplyRecords` (per-record read), the
   `Search` join, and the console's `Totals`/`ListUsers` fan-out. This tells us
   whether §6-A's single connection is actually too slow, or whether the whole
   pool debate is premature.
5. **Concurrent-writer behaviour.** With two connections and the *current*
   `ApplyRecords`, demonstrate the race (or its absence) so §6-B is justified by
   evidence, not theory.

## 6. Decisions I need from you

1. **Engine: libSQL Cloud first, or Turso Database?** I recommend **libSQL
   first**: it keeps FTS5 and the sync protocol, and it is the smallest change.
   Turso Database buys MVCC at the cost of rewriting search and adopting the
   `tursogo-serverless` driver - worth it only if write concurrency is the
   measured bottleneck.
2. **Concurrency: A (one connection, correct now) or B (atomic LWW + pool)?** I
   recommend **A for the first cloud release**, with B as a separate, tested
   change once the latency spike (§5.4) shows the queue. Shipping B blind is how
   the lost-update bug comes back.
3. **Deletion: explicit child deletes, or trust the remote's FK setting?** I
   recommend **explicit**, always - it is portable and it is already the pattern
   for `records_fts`.
4. **Scaling model: one cloud database, or per-tenant databases?** I recommend
   **one database first**; per-tenant is the real long-term lever but it is the
   project in the other doc, not this one.

## 7. What we are not doing

- Not replacing `modernc.org/sqlite`; the community path keeps it and keeps its
  single connection and pragmas.
- Not claiming MVCC / `BEGIN CONCURRENT` on libSQL.
- Not adopting an embedded-replica driver (`go-libsql`): it needs cgo, which
  breaks the static cross-compiled binary that is the whole point of the
  community build.
- Not putting the auth token in the DSN.
- Not raising `MaxOpenConns` without first making the LWW write race-free.

## 8. Evidence

- `libsql/sql.go` (`libsql-client-go`): `file:` delegates to a present
  `sqlite`/`sqlite3` driver; `auth_token` in the URL is refused;
  `NewConnector(url, WithAuthToken(...))` is the supported path. Fetched
  2026-10-11.
- `libsql-client-go` README: points Turso Cloud users at `go-libsql` (embedded
  replicas) and Turso Database users at `turso-go`.
- `docs.turso.tech/tursodb/concurrent-writes.md`: MVCC / `BEGIN CONCURRENT` is
  a Turso Database feature.
- `docs.turso.tech/sdk/go/quickstart.md`: `tursogo-serverless` is the pure-Go
  remote driver for Turso Database; the CGO table marks embedded replicas as the
  one that needs cgo.
- `docs.turso.tech/cloud/limitations.md`: `journal_mode` and `busy_timeout` are
  not settable on Turso Cloud.
- Our own: `server/internal/store/store.go` (pragmas, one connection),
  `records.go` (`ApplyRecords` read-then-write), `admin.go` (`DeleteUser`
  cascade), `doc/tabversed-database-architecture.md`.
