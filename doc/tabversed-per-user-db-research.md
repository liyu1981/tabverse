# Per-user databases: design review

Status: **research (2026-10-11), superseded by ADR 0027.** This records the
review of a proposed storage split (one SQLite file per user instead of one
shared file), re-examined against libSQL as the available engine (see §4). The
split was subsequently adopted and built as
[ADR 0027](../adr/0027-user-content-lives-in-a-per-user-database.md): user
content lives in a per-user database, accounts and auth stay central. The
recommendation in §6 is historical.

Follows ADR 0001 (server-authoritative sync), ADR 0002 (privacy posture),
ADR 0009 (multi-tenant and the console) and ADR 0012/0013 (accounts).

- §1 what we run today
- §2 the proposal
- §3 pros and cons of the split
- §4 libSQL
- §5 what it means for Tabverse
- §6 recommendation
- §7 open questions and when to revisit
- §8 sources

---

## 1. What we run today

One SQLite file for the whole server. `cmd/tabversed/serve.go` calls
`store.Open(cfg.DBPath)` once and hands the single `*store.Store` to the API,
the realtime hub and the retention loop.

| Piece | Where | Notes |
| --- | --- | --- |
| One DB handle, one file | `server/internal/store/store.go` | `TABVERSED_DB_PATH` |
| Single writer | `store.go:41` | `SetMaxOpenConns(1)` on purpose, so one writer serializes and the deferred read-then-write LWW check cannot hit `SQLITE_BUSY` |
| DSN pragmas | `store.go:30` | `busy_timeout(5000)`, `journal_mode(WAL)`, `foreign_keys(1)` |
| Tenant-scoped tables | `store.go` migration | `records`, `records_fts`, `devices`, `tokens`, `invites` all carry `user_id` |
| Account tables | same file | `users`, `identities`, `email_tokens`, `verif_tokens`, `retired_subjects`, `audit_log`, `server_secrets` |
| Cascades | `users(id) ON DELETE CASCADE` | `DeleteUser` also deletes `records_fts` rows by hand (FTS5 is a virtual table and is not covered by FK cascades) |
| Cross-user queries | `internal/store/admin.go`, `internal/retention/` | `ListUsers`, `Totals`, `AllUserIDs` sweep. `SearchFor` is **not** cross-user: it takes an explicit `userID` (`admin.go:1016`), like every other console read |

So the footprint is **multi-tenant and logically isolated by `user_id`, but
physically one database** (ADR 0009). Isolation was proven at the row level;
it was never made physical.

## 2. The proposal

Split storage by *content*, not by "which table carries a `user_id`":

| Region | Contents |
| --- | --- |
| **Central DB** | `users`, `devices`, `tokens`, `invites`, `identities`, `email_tokens`, `verif_tokens`, `retired_subjects`, `server_secrets`, `audit_log` |
| **Per-user DB** | `records`, `records_fts`, and `rev_seq` |

This is deliberately narrower than an earlier draft, which also moved
`devices`/`tokens`/`invites` per-user because they foreign-key to `users`.
That trades a cheap central lookup for a fleet problem:

- They are on the **authentication** path. `LookupToken`
  (`internal/store/users.go:73`) resolves a presented hash on every request;
  keeping the table central keeps that one indexed query, makes a fresh
  pairing work immediately, and makes a revoke bite immediately. Per-user,
  every request would need a central hash -> user index anyway, so the split
  would buy nothing and cost fans-out.
- They keep `REFERENCES users(id) ON DELETE CASCADE`, so the cross-file
  foreign-key problem in §3.3 is confined to `records`.
- The console counts read from them (`device_count`, `token_count`,
  `Totals.Devices`, `Totals.ActiveTokens`) stay exact and cheap.

`rev_seq` moves the other way, *into* the user DB, even though it sits in
`users` today. It is not content, but it is the ordering key of the record
stream, written in the same transaction as the record (`nextRev`,
`internal/store/records.go:84`):

- Splitting it turns every push into a two-database write. Worse, per-user
  revisions must be assigned in the same order records become visible
  (clients pull `rev > since ORDER BY rev ASC`, `PullRecords`); two stores can
  commit out of order, letting a client advance past a revision that commits
  later and never deliver that record. Keeping them together avoids a
  per-user lock spanning both writes.
- A copy may stay in the central `users` row as a display cache for
  `ListUsers`, refreshed by the same queue as the counters (§3.1); the
  authoritative value is the one in the user DB.

The motivation is still the fleet argument — hard boundaries for the bulk
data, smaller files, per-user encryption/backup/delete, and sharding — but the
auth-critical, exact tables stay where they are.

## 3. Pros and cons of the split

### Pros

1. **Blast radius / isolation.** Corruption, a runaway query or one huge user
   stays inside their file. Backup, restore, move and "delete my data" become
   per-file operations.
2. **Per-user encryption / data residency.** Each file can live on a
   differently encrypted volume or a different host. With one file, encryption
   is all-or-nothing.
3. **Write concurrency at scale.** Today every user's writes serialize through
   one connection. N independent files give N writers in parallel. This is the
   strongest technical argument, and it only pays off with many active users.
4. **File size / working set.** SQLite and FTS5 behave better when one user's
   index does not share pages with thousands of others; one giant user stops
   bloating everyone.
5. **A sharding path.** User files can move to other hosts/volumes while the
   small central account DB stays put.

### Cons

1. **Cross-user operations fan out — but only over `records`.** With the §2
   boundary the auth-critical tables stay central, so the fan-out is confined
   to record-derived numbers and the sweep:

   - `ListUsers` (`admin.go:42`) and `Totals` (`admin.go:958`) currently read
     the device/token counts and the record tallies in one query.
     `device_count`/`token_count`/`revoked_count` and the device/token totals
     stay exact and central; only `record_count`/`last_activity`/`LiveRecords`
     /`Tombstones`/`ByEntity` need a user DB. Those may be **eventually
     consistent**, so the console request path still opens at most one user DB
     (the account being viewed). `SearchFor` is already scoped to one
     `userID` (`admin.go:1016`) and also opens one.
   - The retention sweep (`internal/retention/retention.go:44`) still iterates
     every user, but it is a bounded background job, not a request.

   Eventual consistency for the counts: because the tallies are cheap, a
   background task can **recompute** rather than apply deltas. The write
   transaction sets a dirty marker beside the record; a relay recomputes
   `COUNT(*)`/`MAX(updated_at)` from that one user DB and upserts the central
   cache (idempotent by construction), and a low-frequency full sweep heals a
   lost marker. The queue exists so the console read path never opens a user
   DB for a tally; the lag is acceptable because the numbers are display only.
   Authority for `rev_seq` is *not* queued — it lives in the user DB (§2). The
   concrete design for that worker is
   [ADR 0026](../adr/0026-cross-user-counters-are-eventually-consistent.md)
   (proposed).
2. **Connection / file-descriptor pressure, and the backpressure it needs.**
   The FD budget is finite and shared: a WAL SQLite file costs **three** OS
   descriptors while open (the database, `-wal` and `-shm`), and every active
   HTTP/WebSocket connection costs one more. The wall is the per-process
   `RLIMIT_NOFILE` (systemd and Docker often default to 1024), not
   `/proc/sys/fs/file-max`. A burst of *concurrently syncing* users is roughly
   `3 x open user DBs + sockets`; 1,000 at once is ~4,000 FDs. `SetMaxOpenConns(1)`
   no longer bounds the server, so the open-handle count needs an explicit
   **LRU open/close pool**, and that cap *is* the FD budget
   (`maxOpenUserDBs ~ LimitNOFILE/3`, minus a socket reserve). Use one
   connection per user DB and set `SetMaxIdleConns(0)` / a short
   `SetConnMaxIdleTime`, so an idle connection releases its three FDs instead
   of being kept alive by `database/sql`; raise `LimitNOFILE` as a backstop,
   not as the design.

   **Backpressure when the cap is pinned.** Reaching the cap normally evicts
   the least-recently-used *idle* handle and reuses the slot; it is only a
   refusal when every slot is held by an in-flight request. Then:

   - Wait a **bounded** interval (e.g. 100-250 ms, never past the request's
     context budget) for a slot to free, since the hold time is a few
     statements on a small file.
   - If none frees, return `503 Service Unavailable` with `Retry-After` and a
     dedicated `store.ErrBusy` (not a generic 500). Map a real `EMFILE` to the
     same response, so a burst never surfaces as an opaque 500.
   - **Never wait until done.** Unbounded waiting does not remove the limit,
     it moves exhaustion to sockets and goroutines, and it can outlive the
     client's own request timeout.
   - Keep the open short (acquire around the SQL only, not across JSON
     encode/decode or `hub.Publish`) and share one handle per user across
     concurrent requests, so slots recycle in milliseconds.

   The client already absorbs this: a device's `syncOnce` is single-flight
   (`src/data/repo/repo.ts`), a failed push leaves the outbox intact and the
   pull cursor unmoved, `ApplyRecords` is idempotent, and only a 401 triggers
   re-pair (`src/data/repo/serverApi.ts`). Any 5xx is simply retried on the
   next interval or debounced realtime trigger, so shedding loses no data.
   Handlers need a small change: today `handlePull` returns 500 on any store
   error and `writeStoreErr` only maps `ErrNotFound` -> 404
   (`server/internal/api/sync_handlers.go`, `server/internal/api/server.go:279`);
   the busy case becomes `503 + Retry-After`.
3. **Referential integrity across the boundary is lost — for `records`
   only.** `records.user_id REFERENCES users(id)` cannot be enforced when
   `users` is in another file (cross-file FKs do not exist). With the §2
   boundary the loss is confined to `records`: `devices`/`tokens`/`invites`
   stay central and keep their cascades. The application must not write
   records for a missing account, and account deletion needs the orphan-file
   GC in #4 — but it no longer re-implements the device/token/invite
   cascades.
4. **Cross-file atomicity disappears for the record file.** Deleting an
   account today is one transaction (central row + cascaded records + FTS).
   Split, the central delete still cascades devices/tokens/invites atomically,
   but the record file is deleted separately: "delete central row, then delete
   the user file" with nothing spanning them. A crash mid-way leaves an orphan
   file, so a reconciliation/GC pass is still needed — reduced in scope, not
   removed.
5. **Migrations multiply.** `migrate()` is one idempotent pass on one file at
   startup. Per-user means a schema version per file, lazily or background
   migrated, with partial-failure states across many files.
6. **Backups and point-in-time consistency get harder.** One file copy becomes
   a central file plus N user files that must be captured consistently.
7. **It contradicts the deployment shape in ADR 0002.** "Single static binary,
   one file, put it on an encrypted volume" is a feature. A self-hoster with a
   handful of users gets none of the pros and all of the cons.
8. **It does not help one heavy user.** Per-user files parallelize *across*
   users only; one user's push stream is still serialized, now with routing
   overhead on every request.

## 4. libSQL

An earlier version of this section researched Turso — the `tursodb` SQLite
rewrite and the Turso Cloud platform that would have operated a database per
tenant. That is not a foundation to build on: the company is being absorbed
("Turso is joining Supabase"), the hosted products are preview and uncertain,
and the whole move bets on a vendor staying. What survives as a usable engine
is **libSQL**, the SQLite fork Turso shipped for years. It is open source and
self-hostable, so it does not inherit the company's hosted future.

What matters for the split:

- **SQLite-compatible, FTS5 intact.** `records_fts USING fts5(...)` and its
  `MATCH` queries carry over unchanged. The rewrite's Tantivy FTS, which would
  have forced a search rewrite, leaves the picture with `tursodb`.
- **Embedded replicas.** A local libSQL file that syncs to a remote primary is
  the one feature here that `modernc.org/sqlite` does not give us. It matters
  only if a per-user file is meant to have a remote/central primary; for a
  purely local file, the engine already in use is sufficient.
- **Go drivers.** Relevant because the server deliberately uses a CGO-free
  driver (`modernc.org/sqlite`, "no cgo -> easy cross compile"):

  | Package | What it is | CGO |
  | --- | --- | --- |
  | `github.com/tursodatabase/go-libsql` | libSQL embedded replicas | **yes** |
  | `github.com/tursodatabase/libsql-client-go` | libSQL over HTTP | **no** |

  The CGO-free option is the remote/HTTP client, which reaches a file through a
  libSQL server (`sqld`) rather than opening a local path. That is a real
  architectural difference from the current local-file store, not a drop-in.
- **Remote pragmas differ; local files do not.** The noted gaps
  (`user_version`/`application_id` read-only, `busy_timeout` and
  `journal_mode` unsupported) belong to a *remote* libSQL endpoint, not a local
  file. A local per-user libSQL file behaves like SQLite, so the `store.Open`
  DSN is only at risk on the remote path.
- **The control plane is still ours.** No engine removes the fan-out, pooling,
  migration or orphan-GC work in §3. `sqld` can host a single libSQL server; a
  fleet of per-user databases is still something we operate.

## 5. What it means for Tabverse

| Path | What we would get | What it costs |
| --- | --- | --- |
| **Self-host libSQL / `sqld`**, one file per user | SQLite-compatible fork with FTS5 and embedded replicas; a remote primary per file if wanted | CGO for embedded replicas, or a `sqld` endpoint; per-DB migrations, pool/FD budget and orphan GC are still ours. Every §3 con remains. |
| **Remote libSQL via `libsql-client-go`** | CGO-free, fits the cross-compile constraint | A network hop and a libSQL server to run; the local-file simplicity of ADR 0002 is gone. |
| **Keep vanilla SQLite** (`modernc.org/sqlite`) | Single-binary simplicity; the engine is already SQLite-compatible | Nothing new; the single-writer serialization stays. |

Two things this analysis does **not** change:

- The operator console (`internal/store/admin.go`) and retention genuinely do
  cross-user work, so the fan-out cost in §3.1 is real and specific to us —
  but under the §2 boundary it is confined to record-derived counters (served
  from a central cache) and to the background sweep.
- The current isolation is already logical and tested (ADR 0009). A physical
  split buys operational properties, not new isolation guarantees.

## 6. Recommendation

At the current scale and positioning, per-user databases are premature. The
decisive question is not the data model but the product: **are we building a
hosted multi-tenant service?** If yes, per-user files (on libSQL/`sqld`, or
plain SQLite files with a control plane we build) are justified. If we stay a
mostly self-hosted, few-user server, the costs in §3 land on us and the
benefits do not materialize.

If we want to reduce the future cost of the decision without committing, the
low-risk, reversible steps are:

1. Introduce a routing seam — `StoreFor(userID)` — so a later split is a swap
   rather than a rewrite of every call site. Today `*store.Store` is concrete
   and passed everywhere.
2. If a hosted shape is plausible, prototype `libsql-client-go` (CGO-free)
   behind `store.Open` against a local `sqld` on a branch, and measure the
   query patterns against the current `SetMaxOpenConns(1)`. No fleet required.
3. If the real driver is privacy/compliance rather than scale, prefer
   per-user encryption or per-user export over the existing single DB; that
   buys much of the benefit without the fan-out.

Either way, a change this structural should get an ADR before
`internal/store` is touched.

## 7. Open questions and when to revisit

- How many **concurrently active** users do we expect, and is the bottleneck
  writes or file size?
- Do we need per-user encryption, deletion guarantees, or data residency?
- Are we willing to own a file lifecycle (creation races, orphan GC,
  cross-file account deletion) and a per-file migration story?
- Revisit if any of: a hosted multi-tenant offering is committed; a real
  compliance/residency requirement appears; or single-writer contention is
  measured as the bottleneck.

## 8. Sources

- libSQL, the SQLite fork (open source, self-hostable):
  <https://github.com/tursodatabase/libsql>
- Go drivers: <https://github.com/tursodatabase/go-libsql> (embedded replicas,
  CGO) and <https://github.com/tursodatabase/libsql-client-go> (HTTP,
  CGO-free).
- Turso-to-Supabase announcement, which is why the hosted platform is out of
  scope: the <https://turso.tech/> homepage banner, seen 2026-10-11.
