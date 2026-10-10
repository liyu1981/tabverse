# Per-user databases: design review and Turso research

Status: **research (2026-10-11), not decided.** This records the review of a
proposed storage split (one SQLite file per user instead of one shared file)
and the Turso research that was done to sanity check it. No code or schema has
changed. A decision, if we take one, belongs in an ADR, not here.

Follows ADR 0001 (server-authoritative sync), ADR 0002 (privacy posture),
ADR 0009 (multi-tenant and the console) and ADR 0012/0013 (accounts).

- §1 what we run today
- §2 the proposal
- §3 pros and cons of the split
- §4 Turso research
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
| Cross-user queries | `internal/store/admin.go`, `internal/retention/` | `ListUsers`, `Totals`, `SearchFor`, `AllUserIDs` sweep |

So the footprint is **multi-tenant and logically isolated by `user_id`, but
physically one database** (ADR 0009). Isolation was proven at the row level;
it was never made physical.

## 2. The proposal

Split storage into:

- **A central DB** for account data: `users`, `identities`, `email_tokens`,
  `verif_tokens`, `retired_subjects`, `server_secrets`, `audit_log`.
- **A per-user DB** for user data: `records`, `records_fts`, and probably
  `devices`, `tokens`, `invites` (they foreign-key to `users`).

The motivation is the usual fleet argument: hard tenant boundaries, smaller
files, per-tenant encryption/backup/delete, and sharding across machines.

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

1. **Cross-user operations fan out.** `ListUsers`, `Totals`, `SearchFor` and
   the retention sweep stop being one SQL query and become an aggregate over N
   open databases.
2. **Connection / file-descriptor pressure.** One `*sql.DB` per user means
   thousands of live SQLite handles unless there is an LRU open/close pool.
   `SetMaxOpenConns(1)` no longer bounds the server; the open-handle count must
   be bounded explicitly.
3. **Referential integrity across the boundary is lost.** `records.user_id
   REFERENCES users(id)` cannot be enforced when `users` is in another file
   (cross-file FKs do not exist). Devices/tokens/ invites have to move per-user
   too, and what FK cascades used to guarantee becomes application code.
4. **Cross-file atomicity disappears.** Deleting an account today is one
   transaction (central row + cascaded records + FTS). Split, it becomes
   "delete central row, then delete/retire the user file" with nothing
   spanning them. A crash mid-way leaves an orphan file or an orphan account,
   so a reconciliation/GC pass is needed.
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

## 4. Turso research

Sources fetched **2026-10-11** from `turso.tech` and `docs.turso.tech` (see
§8). Pricing was not re-checked here; `doc/tabversed-hosting-decision.md` §2
covers it.

### 4.1 The two products, not one

1. **Turso Database** (`tursodb`, the Rust rewrite formerly called Limbo) — a
   ground-up SQLite rewrite. Headline features: **MVCC concurrent writes**
   (`PRAGMA journal_mode='mvcc'` plus `BEGIN CONCURRENT`; conflicting writers
   get a retryable error), async I/O, native vector search, **Tantivy-powered
   FTS** (not FTS5), page-level encryption, and sync. SQLite-compatible, but
   with real differences. On Cloud it is **early preview**.
2. **libSQL** — the battle-tested SQLite fork, FTS5 intact, used on Cloud for
   years.
3. **Turso Cloud** — the managed platform: a **Platform API/SDK to create
   databases programmatically** (`turso.databases.create({ name, group,
   schema })`), groups for placement, per-database **BYOK encryption**,
   copy-on-write branching, PITR, "recover deleted databases for five days",
   scoped tokens, analytics.

### 4.2 The thesis is literally the proposal

The homepage frames the exact trade: *"Centralized Model: one shared
database… vs. Fleet: a database per tenant."* Claimed properties: per-entity
isolation, "lightweight as a file, scalable as a cloud", per-database
economics, **per-database encryption with customer-held keys**, and one
local→global runtime. The tagline is *"Spin a database for every user, agent,
and tenant."* This is the strongest available third-party validation that the
proposed direction is legitimate at scale.

### 4.3 The machinery that makes a fleet operable

This is the work that is easy to underestimate, and it is what Turso sells:

- **Provisioning as an API**, not a filesystem convention — the DB is created
  and tracked by the control plane, so the app does not hand-roll
  `userID + ".db"` paths.
- **Per-DB BYOK / page-level encryption** — each 4 KiB page encrypted with a
  unique nonce under AEAD (AEGIS-256, AES-GCM, ChaCha20Poly1305), keys never
  stored server-side. This answers the "one shared file cannot be per-user
  encrypted" con directly.
- **Groups** as the placement/replication unit, and **branching** (COW) for
  cheap isolated copies.
- **Scoped tokens** (database, table, action, expiry) so a connection is
  confined to one tenant.
- **Sync as a product** — local-first `push()`/`pull()` with logical
  change-data-capture, checkpointing, and a "last push wins" conflict policy.

### 4.4 What Turso itself walked back

The instructive part:

- **Multi-DB Schemas and ATTACH were deprecated for new users** (roadmap, Jan
  2025). That was their "one parent schema, child DBs auto-migrated" story —
  exactly the migration-multiplication problem in §3.5. They shelved it rather
  than keep maintaining it, and said they would reinvent it.
- **Edge replicas were dropped for new users**, pivoting to syncing the SQLite
  file itself (Turso Sync) over logical CDC instead of page replication.
- **Pragmas differ on Cloud**: `user_version`/`application_id` are read-only,
  and `busy_timeout` and `journal_mode` are **not supported**. Our
  `store.Open` DSN sets two of those; on Cloud they become no-ops. (The
  migration itself uses `CREATE TABLE IF NOT EXISTS`, not `user_version`, so
  that part is portable.)
- **FTS5 vs Tantivy.** `tursodb`'s FTS syntax is not FTS5, so
  `records_fts USING fts5(...)` and its `MATCH` queries would need a rewrite on
  `tursodb`. libSQL is the engine that keeps FTS5.
- **Ownership uncertainty.** The homepage now carries *"Turso is joining
  Supabase to give every agent its own database"* — worth pricing in before
  betting on the managed platform.
- **A central catalog still exists.** Even the fleet model has an
  org/group/DB catalog. Per-user data files never remove the central account
  DB; they only split it — which is exactly the proposal.
- **None of the cons in §3 are removed by the engine.** They are the control
  plane. Turso Cloud is where that work lives; self-hosting `tursodb` leaves
  all of it to us.

### 4.5 Go integration

Relevant because the server deliberately uses a CGO-free driver
(`modernc.org/sqlite`, "no cgo -> easy cross compile"):

| Package | What it is | CGO |
| --- | --- | --- |
| `turso.tech/database/tursogo` | local/embedded + sync, implements `database/sql`, prebuilt libs via `purego` | **no** |
| `turso.tech/database/tursogo-serverless` | remote Turso DB over HTTP, pure Go | **no** |
| `github.com/tursodatabase/go-libsql` | libSQL embedded replicas | **yes** |
| `github.com/tursodatabase/libsql-client-go` | libSQL over HTTP | **no** |

`tursogo` is a `database/sql` drop-in and CGO-free, so it fits the existing
cross-compile constraint and could sit behind `store.Open` on a throwaway
branch.

## 5. What it means for Tabverse

| Path | What we would get | What it costs |
| --- | --- | --- |
| **Adopt Turso Cloud**, one DB per user, central DB for accounts | Provisioning API, per-DB BYOK, branching/PITR, sync — the §3 cons handled for us | Turns the self-hosted single binary into a dependency on a managed (preview, now Supabase-bound) service. Contradicts ADR 0002. FTS5, journals and per-DB schema management all change. |
| **Self-host `tursodb`**, one file per user | MVCC concurrent writes, per-file encryption, no CGO | We rebuild the whole control plane: pool/FD budget, orphan GC, per-DB migrations, cross-DB atomicity, FTS rewrite. Every §3 con remains. |
| **Keep vanilla SQLite**, use Turso as a design reference | Keeps single-binary simplicity | Nothing new; the single-writer serialization stays. |

Two things this analysis does **not** change:

- The operator console (`internal/store/admin.go`) and retention genuinely do
  cross-user work, so the fan-out cost in §3.1 is real and specific to us.
- The current isolation is already logical and tested (ADR 0009). A physical
  split buys operational properties, not new isolation guarantees.

## 6. Recommendation

At the current scale and positioning, per-user databases are premature. The
decisive question is not the data model but the product: **are we building a
hosted multi-tenant service?** If yes, per-user files (and either Turso Cloud
or a self-built control plane modeled on it) are justified. If we stay a
mostly self-hosted, few-user server, the costs in §3 land on us and the
benefits do not materialize.

If we want to reduce the future cost of the decision without committing, the
low-risk, reversible steps are:

1. Introduce a routing seam — `StoreFor(userID)` — so a later split is a swap
   rather than a rewrite of every call site. Today `*store.Store` is concrete
   and passed everywhere.
2. If a hosted shape is plausible, prototype `tursogo` behind `store.Open` on
   a branch and measure MVCC concurrent writes against the current
   `SetMaxOpenConns(1)`. No fleet required.
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
  compliance/residency requirement appears; single-writer contention is
  measured as the bottleneck; or Turso Database leaves preview and its Go
  driver is proven.

## 8. Sources

All fetched 2026-10-11:

- <https://turso.tech/> — homepage, "Millions of Databases. One Architecture.",
  Supabase announcement banner.
- <https://docs.turso.tech/introduction> — what Turso is, feature list.
- <https://docs.turso.tech/llms.txt> — documentation index.
- <https://docs.turso.tech/turso-cloud.md> — Cloud, Turso vs libSQL, preview
  status.
- <https://docs.turso.tech/tursodb/concurrent-writes.md> — MVCC,
  `BEGIN CONCURRENT`, conflict/retry.
- <https://docs.turso.tech/features/multi-db-schemas.md> — deprecated
  multi-DB schemas.
- <https://docs.turso.tech/cloud/limitations.md> — pragma differences.
- <https://docs.turso.tech/cloud/encryption.md> — per-DB BYOK, AEAD, page-level.
- <https://docs.turso.tech/features/embedded-replicas/introduction.md> —
  embedded replicas, encryption at rest.
- <https://docs.turso.tech/sync/usage.md> — push/pull, "last push wins".
- <https://docs.turso.tech/sdk/go/quickstart.md> and
  `sdk/go/reference.md` — `tursogo`, `tursogo-serverless`, CGO table.
- <https://turso.tech/blog/upcoming-changes-to-the-turso-platform-and-roadmap>
  — Jan 2025 deprecations (multi-DB schemas, ATTACH, edge replicas).
