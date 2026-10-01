# Plan: the tab preview reaper (volatile data, reaped in the worker)

Status: **built** (2026-10), as `adr/0016-tab-previews-are-a-cache.md`.
Extension side only. No change to the sync layer, no change to what is stored on
the server.

Two rules decide this, and everything below is them applied:

1. **A thumbnail in IndexedDB is a cache, not data.** It is derived from a live
   Chrome tab's pixels, it is only usable while that tab exists, and it is
   worthless if it is wrong. Losing every row must break nothing, so nothing may
   depend on a row existing, and reaping can never lose anything.
2. **The reap runs in the service worker, on a timer.** The page never pays for
   it, not even once at bootstrap.

Decisions taken, and what each one costs:

| Decision | Effect |
| --- | --- |
| Cadence **5 minutes** | leftovers are gone almost immediately; the worker is woken 12 times an hour, which is the price (§2.4) |
| **No age bound** - a screenshot without a currently open tab goes, and nothing else does | one fewer rule and no "is 7 days the right number" debate; the cap below is the only size bound |
| **The worker owns every delete** - the timer, the session sweep, and the drop on tab removal | one writer for the table; the page keeps `persistPreview` and its in-memory cache (§2.6) |
| **`persistPreview` stays in the page** | the page keeps one IndexedDB write per capture; moving it to the worker would put 80 kB per capture on the message bus for no measured gain |

## 0. Where we are

`src/data/tabSpace/tabPreviewStore.ts` owns the `SavedTabPreview` table
(`id` = `chromeTabId`, `capturedAt`, `preview` = a base64 JPEG data URL of
roughly 30-80 kB). It is written by `persistPreview` from the capture path
(`chromeTab.ts:217,414,450` - tab add, tab update, tab activation), dropped by
`forgetPreview` on tab removal and detach (`chromeTab.ts:286,322`), and pruned
by `pruneStalePreviews` - which is called from exactly one place,
`tabSpaceBootstrap.ts:59`, on page bootstrap.

Four things are wrong with that today, in order of how much they cost:

| # | Problem | Why it hurts |
| --- | --- | --- |
| 1 | The prune runs in the page, during bootstrap | `toArray()` materialises up to 100 rows ≈ 8 MB of base64 in the manager page, before it renders |
| 2 | Its live set is *this window's* tabs (`tabSpaceBootstrap.ts:47`) | bootstrapping a second tabverse window deletes the first window's thumbnails (ADR 0006 allows one manager page per window, more than one window) |
| 3 | `loadPreviews` (line 52) runs *before* the prune (line 59) | a row from a previous browser session whose numeric id was recycled lands in the cache and shows **another page's screenshot** on a live tab; the prune then keeps it because the id *is* live |
| 4 | Nothing reaps while no page is open | the five `dbAuditor`s that run on `chrome.idle` (`background.ts:25-29`) do not include previews, and the worker never prunes, so the table only converges when a manager page happens to open |

Two smaller ones worth folding in while we are here:

- **The placeholder for "no preview" is a remote image.**
  `TabPreviewCache.getPreview` returns
  `https://dummyimage.com/500x280/ffffff/666666&text=Preview+Not+Yet+Generated`,
  so hovering a tab without a thumbnail makes the browser fetch from a third
  party - for a feature whose entire point is that the picture never leaves the
  machine, and with a broken-image glyph when that host is unreachable.
- **`MAX_STORED_PREVIEWS` is a row count, not a size.** 100 × 80 kB is ~8 MB.

## 1. Rule 1 applied: the table is a cache

**1.1 Nothing may depend on a row.** The only consumer is the hover panel in the
live tabverse list (`TabSpaceListView:132` → `TabCard needPreview` →
`TabDetailPreviewPanel`). The rules that follow:

- A missing preview renders the card without an image - and the placeholder
  becomes a **local** one (a grey `data:` block or a styled empty box), not a
  fetch. §1.2.
- Every preview operation stays `try/catch` and never throws into a caller. A
  failed write is a missing thumbnail, nothing more.
- **The upgrade path may simply `clear()` the table.** `dbUpgrade`
  (`src/storage/upgrade.ts`) is empty; the next schema bump for
  `SavedTabPreview` must not add to it. That is the point of volatile data, and
  it is worth a line in the ADR so nobody later "fixes" it.
- The existing guard stays: previews are not in
  `SYNC_TABLE_BINDINGS`, so they cannot travel to a server
  (`data/repo/__tests__/previewsStayLocal.test.ts`).

**1.2 Losing the table is a supported state, and is tested as one.** New test:
clear `SavedTabPreview`, then assert the tabverse list still loads, the sync
layer still starts, and the previews table comes back empty rather than
throwing. A cache with a delete-the-whole-table test is a cache; without one it
is a table nobody dares to touch.

**1.3 The capture path may drop images.** `doCapturePreview` captures the
visible tab of a window and keeps the frame only if the tab is still the active
one. Under rule 1 that check is an optimisation, not a correctness requirement -
a wrong-but-recent thumbnail is worth less than a missing one - so this stays as
it is, untouched.

## 2. Rule 2 applied: one reaper, in the worker, on a timer

**2.1 A new module owns the reap.** `src/data/tabSpace/previewReaper.ts`:

```
reapPreviews(opts?: { liveTabIds?: number[] }): Promise<ReapReport>
```

`liveTabIds` is injected for tests; in production it defaults to
`chrome.tabs.query({})`, i.e. **every tab in every window of the profile** -
which is what fixes problem 2, and what makes the whole thing safe to run from a
context that knows nothing about any tabverse. The report is
`{ scanned, dropped: { staleSession, unowned, overCap } }` for the log.

**2.2 The reaper never reads a payload.** It works on primary keys and indexed
fields only - `orderBy('capturedAt').primaryKeys()`,
`where('sessionId').equals(...).primaryKeys()` - and deletes by key. A row whose
`preview` is 80 kB must never be deserialised to decide whether to delete it,
in the worker or anywhere. This is testable: a row whose `preview` is a getter
that throws must still be reaped (§3.1).

**2.3 What makes a row unowned.** Three rules, in this order, because the first
one is both the cheapest and the only one that is always true:

1. **A row from an earlier browser session is unowned.** Every row carries the
   id of the session that wrote it (`sessionId`); the current one lives in
   `chrome.storage.session`, whose lifetime is exactly "this browser run" - it
   is cleared when the browser exits and is visible to both the worker and the
   pages (`storage.session` exists since Chrome 102; our floor is 140).

   This is what makes rule 2 mean what it should mean. "A screenshot without a
   currently open tab" is not quite enough on its own: chrome tab ids are
   session-scoped and **recycled**, so after a restart id 42 can be a live tab
   that is a completely different page - and the row from the previous run would
   pass a liveness test, be shown on the wrong tab, and never be reaped. The
   session id is what says *the same tab* rather than *a tab with that number*.
   It also sweeps the entire previous run in one pass, without knowing a single
   tab id.
2. **A row whose tab is gone is unowned.** `id` not in the set from
   `chrome.tabs.query({})` - the tab was closed, or its tabverse was restored
   into another window and got new ids. This is the whole ownership rule the
   user asked for, and it is the only one that runs every 5 minutes.
3. **A row over the cap is unowned.** `MAX_STORED_PREVIEWS` (100), oldest
   `capturedAt` first. With a 5-minute reap the cap is not about tidiness: a
   profile that keeps 300 tabs open would otherwise hold 300 screenshots.

**2.4 Cadence: every 5 minutes.**

- `chrome.alarms.create('tabverse-preview-reap', { periodInMinutes: 5 })`,
  created on `runtime.onInstalled` and on worker start **only when absent**
  (`chrome.alarms.get` first) - calling `create` on every worker start would
  push the period out each time the worker wakes. The `alarms` permission is
  already in the manifest and unused, so nothing changes there.
- **Once per browser session, at worker start**, guarded by a
  `chrome.storage.session` flag. This one is not redundant with the alarm: it is
  the run that stops a previous session's screenshot from being shown on a
  recycled tab id in the seconds *before* the first alarm fires, and it is the
  run that sweeps the whole previous run at once (§2.3.1).
- **Cost of a run**: one `chrome.tabs.query({})` (already in memory), one
  indexed primary-key read of a few hundred keys, one `bulkDelete` of keys. No
  payloads, no network, no other table. Every step returns early when there is
  nothing to drop, because the honest cost of a 5-minute timer is the worker
  waking 12 times an hour, not the work it does.

**2.5 The page loses the prune, keeps everything else.**
`tabSpaceBootstrap` keeps `loadPreviews` and drops `pruneStalePreviews`: the
reap is the worker's job, and bootstrap should be short. `loadPreviews` filters
on the current `sessionId`, so a page that bootstraps before the worker's
session sweep cannot resurrect an old row either.

**2.6 The worker owns every delete; the page keeps the writes.** The two
`forgetPreview` calls in `chromeTab.ts:286,322` go away (the in-memory
`tabSpaceStoreApi.removePreview` stays - that cache is the page's), and the
worker registers its own `chrome.tabs.onRemoved` / `onDetached` listeners that
call `forgetPreview(chromeTabId)`.

- One writer for deletes means the ownership rule lives in exactly one place,
  and a tab closed a moment ago is dropped a moment ago rather than up to five
  minutes later.
- Chrome wakes the worker for these events, so the listener is not a
  "the worker is asleep" problem. What *can* be missed is a tab closed while the
  browser is shutting down: the session sweep at the next start is what catches
  those, which is another reason it exists.
- The page's own handlers stay exactly as they are otherwise - a removed tab is
  still recorded in the History tool, removed from the store and the tabverse,
  and saved; only the preview-table delete moves.

## 3. Tests (vitest + fake-indexeddb, no browser)

**3.1 `src/data/tabSpace/__tests__/previewReaper.test.ts`**

- drops rows from an earlier `sessionId`, keeps the current one's;
- keeps a row owned by a tab in **another window** and drops one whose tab is
  gone - the pair that today's prune gets wrong;
- enforces the cap oldest-first (moved from `tabPreviewStore.test.ts`);
- treats a row with no `sessionId` (written by an older build) as unowned;
- never throws on an empty or missing table, and returns early without deleting
  when there is nothing to drop;
- **never reads a payload**: a row whose `preview` is a throwing getter is
  reaped all the same.

**3.2 `tabPreviewStore.test.ts`** - `persistPreview` stamps the current session
id; `loadPreviews` returns only this session's rows.

**3.3 `storage/__tests__/TabSpaceDatabase.upgrade.test.ts`** - opening a v10
database with the v11 schema keeps every other store, and the preview table is
readable afterwards (empty is fine).

**3.4 The rule-1 test** (§1.2): clear the table, assert nothing else moved.

**3.5 `background.ts`** - the alarm name, the session guard and the worker's
tab listeners are thin enough to review by eye once the reaper itself is tested.

## 4. What lands, in order

1. **Session id + schema v11.** `tabPreviewSchema.ts` gains `sessionId`
   (`id, capturedAt, sessionId`), `TABSPACE_DB_VERSION` 10 → 11,
   `currentPreviewSessionId()` in `tabPreviewStore` backed by
   `chrome.storage.session`, `persistPreview` stamps it, `loadPreviews` filters
   on it. *This alone fixes problem 3 and most of the leftover rows.*
2. **`previewReaper.ts` + its tests**, with `liveTabIds` injected. *Fixes 1
   and 2 as a unit.*
3. **Wire it into `background.ts`**: the 5-minute alarm, the once-per-session
   sweep, and the `onRemoved`/`onDetached` listeners that own the immediate
   delete. Drop the prune from `tabSpaceBootstrap` and the two `forgetPreview`
   calls from `chromeTab.ts`. *Fixes 4 and takes the 8 MB off the page.*
4. **The local placeholder** in `TabPreviewCache`/`TabDetailPreviewPanel`, and
   the "losing the table breaks nothing" test.
5. **ADR 0016** (`adr/`): volatile data, worker-owned reap, session-scoped
   ownership. Plus one line each in `ARCHITECTURE.md` (the previews row in the
   repository table) and the storage section of `README.md`.

## 6. Still open

- **The placeholder**: a grey `data:` block, or no image at all (the panel shows
  favicon, title and url only)? The second is quieter and smaller; the first
  keeps the panel's shape.
- **The cap**: 100 rows is ~8 MB worst case. A byte budget would be honest about
  the outliers, at the cost of reading the payloads - which §2.2 forbids. Likely
  answer: keep the count, and lower it if anyone ever notices.