# tabversed hosting: research and decision

Status: **decided 2026-09-28 — stay on Go + SQLite.** The Cloudflare port is
deferred, not cancelled; the conditions that would reopen it are in §6.

This document replaces the earlier "rewrite on Cloudflare" draft. It keeps the
research that motivated the rewrite (so the decision is auditable), records what
we measured, and turns the findings into a hardening backlog for the server we
are actually running.

- §1 what we run today
- §2 the research: managed/serverless storage pricing (verified 2026-09-28)
- §3 what we measured locally
- §4 the decision and why
- §5 the backlog this research produced (Go + SQLite multi-tenant hardening)
- §6 when to revisit Cloudflare
- §7 the deferred Cloudflare design (appendix, unchanged in substance)
- §8 open questions that survive the decision

---

## 1. What we run today

| Piece                             | Where                                    | Notes                                                     |
| --------------------------------- | ---------------------------------------- | --------------------------------------------------------- |
| HTTP routes, CORS, auth middleware | `server/internal/api/`                   | 8 routes, hand-rolled `ServeMux`                            |
| LWW / idempotency / tombstones     | `server/internal/store/records.go`       | one read-then-write transaction per push                   |
| SQLite schema + FTS5              | `server/internal/store/store.go`         | `records`, `records_fts`, `users`, `devices`, `tokens`, `invites` |
| WS fan-out in-process              | `server/internal/hub/hub.go`             | `map[userID]map[*Conn]`, 25s ping, drop-oldest buffer     |
| Token/invite crypto               | `server/internal/auth/auth.go`           | SHA-256 hash, `crypto/rand`                                |
| Retention loop                    | `server/internal/retention/`             | 6h ticker, prune `session` → tombstones                    |
| Config                            | `server/internal/config/config.go`       | env vars                                                   |
| Tests                             | `*_test.go`                              | 740 LOC, `-race`                                           |
| Contract                          | `api/openapi.yaml`                       | 399 lines, single source of truth                          |
| Client                            | `src/data/repo/`                         | 1731 LOC, 8 suites, no network in tests                   |

Deployment shape today: **one process, one SQLite file, one owner account**
(`POST /auth/bootstrap` succeeds only while the database has no users). It is a
self-hosted, single-user design, which ADR 0002 recommends users run themselves.

## 2. Research: what hosting costs

All figures fetched from vendor pricing pages on **2026-09-28**; they drift, so
re-check before quoting them anywhere user-facing.

### 2.1 Managed / serverless storage

|                        | Entry price        | Storage included | Rows read          | Rows written           | Egress            | Interactive transactions |
| ---------------------- | ------------------ | ---------------- | ------------------ | ---------------------- | ----------------- | ------------------------ |
| **Cloudflare D1**      | $5/mo (free tier)  | 5GB, then $0.75/GB | 25B/mo, then $0.001/M | 50M/mo, then **$1.00/M** | **$0**       | **no** — `db.batch()` only |
| **Turso (libSQL)**     | $4.99/mo (free: 100 DBs, 5GB, 500M read, 10M written) | 9GB, then $0.75/GB | 2.5B/mo, then $1/B | 25M/mo, then $1/M | 10GB, then $0.35/GB | **yes** — `BEGIN`/`COMMIT`/`ROLLBACK`, 5s write-lock |
| Turso Scaler / Pro    | $24.92 / $416.58   | 24GB / 50GB      | 100B / 250B        | 100M / 250M            | 24GB / 100GB      | yes                     |
| **sqlitecloud / CloudSync** | $19/mo (1GB RAM, 3GB) | 3GB         | —                  | —                      | —                 | yes (hosted `sqld`)      |
| Self-hosted `sqld` on a Hetzner box | €4.49 | your disk | — | — | your 20TB | yes |

Adjacent Cloudflare prices, for completeness: Workers $5/mo incl. 10M requests
+ 30M CPU-ms (then $0.30/M req, $0.02/M CPU-ms, $0 egress); Durable Objects
1M requests + 400k GB-s included, then $0.15/M req and **$12.50/M GB-s** with
128MB billed per instance (hibernating objects are not billed for duration);
R2 $0.015/GB-mo, $4.50/M writes, $0.36/M reads, $0 egress; Pages 500 builds/mo
free with unlimited bandwidth.

### 2.2 Plain servers

| Provider / size                | Price     | Notes                                  |
| ------------------------------ | --------- | -------------------------------------- |
| Hetzner CX22 (2 vCPU/4GB/40GB) | €4.49/mo  | ~20TB traffic in EU, backups +20%       |
| Hetzner CX32/33 (4/8GB)        | €8.49/mo  |                                        |
| Hetzner CX43 (8/16GB)          | €15.99/mo |                                        |
| DigitalOcean 1 / 2 / 4 / 8 GB  | $6 / $12 / $24 / $48 per month | typical US region |

### 2.3 The two conclusions that mattered

1. **Hosting cost is not a reason to move.** A €4.49 Hetzner box and the $5
   Workers plan are the same money. Estimated usage at **1,000 users × 2
   devices** (≈8k pulls + 8k pushes/day, ~20 rows read per pull, ~30 read and
   ~40 written per 10-record push) is ≈12M rows read and ≈10M rows written per
   month — **inside D1's included allowance**, i.e. $5–6/mo all-in. The first
   real cost wall in serverless land is ~**100k users**, and there it is the
   $1.00/M *rows written* term (~$900/mo), not compute.
2. **Bandwidth is a non-issue on both sides.** Sync is delta-based, so a device
   moves roughly 1MB/day; 1,000 users is well under 100GB/month against 20TB
   included (Hetzner) or $0 egress (Cloudflare). R2's zero-egress pitch and
   Cloudflare's zero-egress pricing are worth nothing to us at this data volume.

The real difference between the two options is therefore **operational, not
financial**: no scale-to-zero, no HA, no managed TLS/DDoS, and backups and
on-call being your problem on a box you maintain.

## 3. What we measured locally

Two experiments, both on SQLite 3.45 (the same engine D1 and libSQL embed), so
the results transfer to a managed port.

### 3.1 FTS5 maintenance is a full table scan per write — the real cliff

`ftsReplace` in `server/internal/store/records.go` deletes the old index row
with `DELETE FROM records_fts WHERE user_id = ? AND entity = ? AND
record_id = ?`. All three columns are `UNINDEXED`, so SQLite cannot seek; it
scans the whole FTS table on **every record write**. Measured, per delete:

| rows in `records_fts` | delete by UNINDEXED filter | delete by `rowid` |
| --------------------- | ------------------------- | ------------------ |
| 40,000                | 9.3 ms                    | 0.04 ms             |
| 160,000               | 33.5 ms                   | 0.02 ms             |
| 640,000               | **164.7 ms**              | 0.02 ms             |

Linear in table size versus flat — a 4,000× gap at 640k rows. A standalone
`fts5` table stores its rows in an ordinary rowid b-tree, so **assigning an
explicit `rowid` at insert time and deleting by `rowid` is a b-tree seek**.

Consequences:

- for the self-hosted server: the current cost is invisible (one user's data is
  thousands of rows) and becomes a CPU cliff as soon as one database holds many
  tenants;
- for a D1/Turso port: the scan is also **billed as rows read**, so the naive
  port would read the entire index per pushed record;
- it is a cheap, correct fix in both worlds → backlog item B1 (§5).

### 3.2 Per-tenant database files are cheap, connection handling is not

4,000 tenant databases × 500 records each: 56KB per tenant, 229MB total,
created without trouble. Disk is therefore not the constraint on tenants per
box; open file descriptors and the LRU pool around them are (SQLite has no
cheap "open more" — each handle costs an fd plus WAL/shm files).

## 4. The decision and why

**Keep the Go server with SQLite.** Concretely:

1. The cost motivation evaporated (§2.3): at realistic scale both options are
   ~$5/month, and the first meaningful serverless bill is an order of magnitude
   away.
2. Go + SQLite is a good fit for the actual workload, not a compromise:
   per-user data is small, writes are serialized per tenant anyway, and delta
   sync means very little traffic.
3. A Cloudflare port is not free in engineering terms: D1 has no interactive
   transactions, so the LWW push has to be restructured into one `db.batch()`
   (with rev allocation and stale classification moved into JS), the client
   gains mandatory push chunking, and FTS maintenance has to be rebuilt. That
   is ~2–3 weeks of work and a new set of failure modes, paid for with benefits
   we do not need yet.
4. The one thing Cloudflare uniquely offers at the top end is multi-region
   write scaling and zero-ops. That matters when there are thousands of paying
   tenants; today there are not.
5. ADR 0002's privacy posture ("self-host a single static binary, you choose the
   server") stays intact and cheap to honour. A shared hosted deployment would
   have forced a rewrite of that story too.

What we give up, stated honestly: no scale-to-zero (€4.49 is paid at zero users
as well), single-node durability, and no managed TLS/DDoS. §5 prices those in
engineering terms.

## 5. Backlog produced by this research (Go + SQLite hardening)

Ordered by value per unit of effort. B1 is the one that matters for
multi-tenancy; the rest make the single-node option survivable.

| #    | Item                                                                                       | Why                                                                    |
| ---- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| B1   | **Rowid-keyed FTS maintenance**: add `INTEGER PRIMARY KEY` `seq` to `records`, insert `records_fts` with an explicit `rowid = seq`, delete with `WHERE rowid = ?`  | removes the O(table) scan per write (§3.1); required for any future shared-DB or managed port; ~30 LOC + a migration |
| B2   | **Per-tenant database pool with an LRU** (or one file per user, bounded open handles), keeping today's single-tenant mode as the degenerate case | the missing piece for a shared deployment (§3.2)                     |
| B3   | **Backups**: `sqlite3 .backup` / `VACUUM INTO` on a timer, encrypted, off-box, with a restore drill in CI | the real substitute for managed durability; a single `.db` file is a single point of failure |
| B4   | **Expose the knobs the config already has** (`max_record_bytes`, `sync_batch_limit`, `retention_days`, `ws_origins`) in one documented table and keep them in sync with `server/README.md` | multi-tenant hardening needs them adjustable per deployment |
| B5   | **Bootstrap policy switch**: current "first pairer owns the server" is fine self-hosted but wrong for a shared deployment (§8) | decide before anyone runs it publicly |
| B6   | **Observability**: per-user record counts, p99 push latency, WS connection gauge, and a log line per prune | you cannot operate a multi-tenant box from `log/slog` defaults |
| B7   | **Rowid fix in the D1/Turso spike if we ever port** — already answered, keep the answer here | avoids re-running §3.1 |

B1 and B3 are the two that turn "works for me" into "safe to expose".

## 6. When to revisit Cloudflare

Reopen the port when **any** of these becomes true:

- more than a few thousand active tenants on one deployment, or per-tenant write
  throughput that a single-writer SQLite file cannot absorb (measure with B6
  first);
- a requirement for multi-region or multi-writer durability, which SQLite cannot
  provide on one box at any price;
- the hosted service is the product (i.e. users do not self-host), which makes
  zero-ops, scale-to-zero and managed TLS the dominant requirements;
- operational load (paging, backups, upgrades) exceeds a couple of hours a month.

The trigger is operational, not financial — revisit when the *box* becomes the
problem, not when the bill does.

## 7. Appendix: the deferred Cloudflare design

Kept so the work is not lost. Mapping and phases as previously drafted.

| Go component                 | Cloudflare replacement                                             |
| ---------------------------- | ------------------------------------------------------------------ |
| `cmd/tabversed` + `net/http` | Worker (`worker/src/index.ts`)                                       |
| `internal/store` (SQLite)    | D1 (or Turso, if interactive transactions matter — §2.1)             |
| FTS5 index                   | D1 FTS5, **rowid-keyed per B1**                                     |
| `internal/hub`               | Durable Object per user, WebSocket Hibernation API                  |
| `internal/retention` ticker  | Cron Trigger                                                        |
| `internal/auth` crypto       | Web Crypto                                                          |
| `TABVERSED_*` env            | `wrangler.jsonc` vars + secrets                                      |
| `--db data/tabversed.db`     | D1 Time Travel + nightly dump to R2                                 |
| `go test -race`              | `vitest` + `@cloudflare/vitest-pool-workers`                        |
| `doc/tabverse-website` build | Cloudflare Pages                                                     |

Three things that were the hard parts, and what we now know about them:

1. **No interactive transactions in D1** → one `db.batch()` per push, one
   `SELECT … IN (…)`, one `UPDATE users SET rev_seq = rev_seq + n`, stale
   classification in JS. Consequence: Workers subrequest limits force the sync
   batch limit down (500 → ~200) and the **client must start chunking pushes**
   (`src/data/repo/repo.ts` sends the whole outbox in one request today).
2. **FTS maintenance** → answered by §3.1: rowid-keyed, or search moves
   elsewhere. Not a spike any more.
3. **DO fan-out** → straightforward; keep the Hibernation API or pay
   $12.50/M GB-s.

Note also that Cloudflare **Containers** are not a way to keep the Go binary
with SQLite: no persistent disk for containers, and an always-on 1 vCPU
container costs roughly $57/month (~10x the Hetzner box).

Rough effort if it is ever needed: 15–22 days plus a differential test pass
against the Go server, using `api/openapi.yaml` as the contract.

## 8. Open questions that survive the decision

1. **Does the server stay single-owner?** `bootstrap` currently makes the first
   pairer the owner, which is right for self-hosting and wrong for a public
   endpoint. B5.
2. **Where is the multi-tenant data boundary?** One file per user (isolation,
   easy backup, no cross-tenant queries) versus one file with a `user_id`
   column (simpler ops, needs B1 + row-level care in every query). B2.
3. **Search**: keep server-side FTS5 (with B1), or accept the ~760 LOC of
   client-side indexing back? Server-side is better for the user; it only needs
   B1 to scale.
4. **Retention default** (14 days for `session` snapshots) is a policy that a
   shared deployment may want per user.
