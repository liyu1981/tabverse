# ADR 0001: server authoritative sync

Status: accepted (2026-09)

## Context

Tabverse was a pure client-side MV3 extension. Keeping several extension
contexts (service worker, manager page, popup) converged required:

- leader election among manager tabs (`src/data/tabSpaceRegistry`,
  `broadcast-channel`)
- cross-context change fan-out (`dexie-observable` + `pubsub-js`)
- settings in `window.localStorage`, which the MV3 service worker cannot read
  at all (the background log level and Dropbox settings silently did nothing)
- `setTimeout` based persistence in a service worker Chrome may kill after
  ~30s
- whole-database JSON dumps to Dropbox as the only "sync"

Every one of those exists to compensate for having no coordination point
outside the browser.

## Decision

Introduce `tabversed`, a Go server, as the single source of truth:

1. **Server authoritative state.** Records carry a per-user monotonic
   revision (`rev`); clients keep a cursor and pull deltas.
2. **Conflicts** are last-writer-wins on the client supplied `updated_at`
   (unix ms). Losing writes come back with `status: "stale"` plus the winning
   copy, so the client resolves in one round trip.
3. **Deletes are tombstones** propagated through the same delta channel.
4. **Realtime** is one WebSocket per device carrying `records_changed`
   events; it only signals _that_ something changed, never _what_ — clients
   always reconcile through delta pull, which keeps the server trivial and
   makes dropped frames harmless.
5. **Offline first.** The extension keeps Dexie as a local cache plus a
   durable outbox in `chrome.storage.local`; the UI never blocks on the
   network and a server outage loses nothing.
6. **Server side retention and full text search** (SQLite FTS5) replace the
   `chrome.idle` background audit and ~760 LOC of client-side indexing.

   > Retention only ever pruned `session` snapshots, and the browser-session
   > feature was deleted later (`adr/0006`), so the server still accepts the
   > `session` entity and still prunes it for pre-0.6 clients. Drop both when
   > no supported build pushes sessions any more.

The client side coordination machinery (leader election, change broadcasts)
is deleted rather than ported: with a server there is no election to hold.

## Consequences

- The extension requires an opt-in pairing step; local-only usage keeps
  working exactly as before when no config is present.
- Data now leaves the device (see ADR 0002).
- Two sync runtimes (page + service worker) can run concurrently against the
  same account. This is safe because pushes are idempotent and the cursor is
  shared, at the cost of some redundant traffic.
- The server becomes a dependency for _sync_, not for _use_: `tabversed`
  being down degrades to the old local-only behavior.
