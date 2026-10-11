# ADR 0026: cross-user counters are eventually consistent

Status: **accepted (2026-10-11).** Implemented alongside the physical split of
[ADR 0027](0027-user-content-lives-in-a-per-user-database.md); the worker lives
in `internal/counters`.

Extends [ADR 0009](0009-multi-tenant-and-server-console.md) (the operator
console and its cross-user reads), follows
[ADR 0001](0001-server-authoritative-sync.md) (the sync protocol) and the
background-job precedent of [ADR 0002](0002-privacy-posture.md) (retention).
Plan: none yet.

## Context

The console has two cross-user reads. `ListUsers` returns one row per account
with `device_count`, `token_count`, `revoked_count`, `record_count` and
`last_activity`; `Totals` returns deployment-wide device/token/record counts
and a per-entity breakdown. Today both are a **single SQL query over the single
file** (`internal/store/admin.go`).

The per-user split reviewed in the research doc moves `records` and
`records_fts` into one file per user while `users`, `devices`, `tokens` and the
account tables stay central. Under that boundary those two reads stop being one
query: the record-derived numbers become an aggregate over N open databases.
Doing that on the read path is the exact cost the split is meant to avoid -
latency that grows with the number of users, and a burst of file descriptors
against the budget in the research doc's §3.2.

The saving observation is that these numbers do not matter enough to be exact.
Nothing authenticates on them, nothing orders the sync stream by them, and no
access decision reads them. **The console is a directory**
([ADR 0014](0014-console-is-a-directory-then-an-account.md)), and a directory
being a little behind is not a correctness problem.

The values that *must* be exact stay next to their data and are untouched here:

- **Token → user** (`LookupToken`) and **revocation/disabled** are central and
  on the authentication path; a fresh pairing and a revoke take effect
  immediately.
- **`rev_seq`** is authoritative in the user DB and orders the sync stream
  (`PullRecords`); it is never computed from a cache.
- **`device_count`/`token_count`/`revoked_count`** come from central tables the
  console already holds, so they stay live and exact.

What is left - the record tallies (`record_count`, `last_activity`,
`LiveRecords`, `Tombstones`, `ByEntity`, `ArchivedRecords`) and a copy of
`rev_seq` for the user list - is derived and may lag.

There is already a background pass for cross-user work:
`internal/retention` runs on a ticker and walks `AllUserIDs`. This ADR keeps
that shape and adds the aggregation that would otherwise fall on the read path.

## Decision

1. **Derived counters may lag; exact values may not.** The record-derived
   tallies and the `ListUsers` `rev_seq` copy are served from a **central
   cache** and are allowed to be stale. Device/token counts stay live from the
   central tables, and `rev_seq`, token lookup and revocation stay exact where
   they live. The console request path therefore never opens a user DB to
   compute a tally: a `ListUsers` or `Totals` call is a single central query.

2. **The cache is per account and idempotent to rebuild.** It holds exactly the
   derived fields above, keyed by `user_id`, and is written by recomputing from
   one user DB - no deltas. `COUNT(*)` and `MAX(updated_at)` on a small indexed
   file are cheap enough that recompute-and-upsert is simpler and self-healing;
   deltas would add state and drift without saving real work.

3. **The dirty marker is written in the same transaction as the change.** Every
   write that changes record tallies (`ApplyRecords`, `PruneOlderThan`, and the
   archive/unarchive of records) marks the account dirty inside that
   transaction, so the marker cannot be lost relative to a committed change.
   **Discovery is best-effort central**: the handler upserts a
   `counter_dirty(user_id, at)` row after the user-DB commit. A **periodic full
   sweep** is the safety net for the one gap that leaves - a crash between the
   two commits - and for any cache row that drifts.

4. **The relay runs low-priority, in bounded batches, through the same FD
   pool.** It acquires user DBs through the bounded LRU and backpressure of
   §3.2, but is never allowed to shed live sync: it works in small chunks,
   yields between them, and a full sweep is spread across ticks. A relay that
   can starve a sync request has traded one outage for another.

5. **One bad account cannot stall the pass.** A per-account failure is logged
   and skipped, the sweep continues, and the account is retried next tick.
   The pass reports lag (oldest dirty age), queue depth, and error counts, so
   "the counts are stale" is a visible number and not a silent one.

6. **Orphan cleanup shares the pass.** The account deletion in the research
   doc's con #4 leaves a user file with no central row when a crash interrupts
   it. Deleting such a file, and dropping a cache row whose account is gone,
   belongs to this same background worker - it is the same "walk accounts and
   reconcile" shape, and splitting it into a second job would only duplicate
   the lifecycle.

## Consequences

- `ListUsers` and `Totals` stay a single central query regardless of user count;
  the read path never fans out and never contributes to the FD burst. Device and
  token counts remain exact; only the content-derived numbers can be behind.
- Staleness becomes a **product property**, not just an implementation detail:
  an operator may see a record count a few seconds or minutes behind the
  devices. That is acceptable because the numbers are display only, but it has
  to be observable (point 5) and bounded by the tick, or it will be read as a
  bug.
- The design adds central state (`counter_dirty` and the cache), a background
  worker, and a refresh policy. All three exist only if the split is adopted;
  on the single file the counts are computed directly and none of this is
  built.
- A central dirty table (rather than an in-process channel) is what lets the
  worker survive a restart and, later, run in more than one process; the
  trade-off is one more small central write per sync, which the discovery step
  already accepts.
- The split's account-deletion gap (an orphan user file) gets a home in the same
  pass instead of a second, later job.

### What this does not settle

- The **staleness budget** and therefore the sweep/relay interval. It should be
  a stated number (e.g. "counts converge within a minute"), not "whenever".
- Whether the dirty marker is authoritative in the user DB, in central, or both,
  and whether the central discovery index earns its write cost versus a shorter
  full sweep.
- Whether the cache is columns on `users` or its own table, and whether the
  `rev_seq` display copy lives there or on `users`.
- The worker's concurrency: one goroutine like retention, a small pool, or a
  lease over the dirty table for multiple replicas.
- Whether the computes should run at all at current scale, or whether a
  page-sized on-demand fan-out (open the accounts on the visible page, no cache)
  is the better first answer. This ADR is the design for when the fleet is real,
  not a reason to build it early.
