# ADR 0016: tab previews are a cache, and the worker reaps them

Status: accepted (2026-10)

Follows [ADR 0006](0006-window-ownership-and-dexie-4.md) (one manager page per
window), and the "the extension stores what it needs, nothing more" posture of
[ADR 0002](0002-privacy-posture.md).

## Context

`SavedTabPreview` holds a base64 JPEG of every tab, captured with
`chrome.tabs.captureVisibleTab` on tab add, update and activation. A row is
30-80 kB of data URL, it is keyed by `chromeTabId`, and it exists so a tab card
can show a thumbnail on hover.

It has always been reaped by `pruneStalePreviews`, and that was wrong in four
ways at once:

1. **It ran in the page, during bootstrap.** `toArray()` materialised the whole
   table - up to 100 rows, ~8 MB of base64 - in the manager page's heap before
   it had drawn anything.
2. **It used one window's tabs as the ownership test.** `$tabSpace.tabs` is the
   window the page owns (ADR 0006), so bootstrapping a second tabverse deleted
   the *first* tabverse's thumbnails: rows whose ids were perfectly well alive
   in another window.
3. **It restored before it pruned, and chrome tab ids are recycled.** A row from
   the previous browser run whose numeric id had been handed to a different page
   was loaded into the cache (so the wrong screenshot was shown), and then
   *kept*, because from that window's point of view the id was live.
4. **It only ran when a manager page opened.** The five `dbAuditor`s that sweep
   on `chrome.idle` do not include previews, and the service worker never pruned,
   so a table of dead thumbnails sat there until a page happened to start.

And one thing that is not about reaping at all: `getPreview` answered "no
thumbnail" with a `https://dummyimage.com/...` URL, so hovering a tab without a
captured picture fetched an image from a third-party host - for the one feature
whose entire premise is that the picture never leaves the machine.

## Decision

**The preview table is a cache: nothing depends on a row, and the service worker
owns every delete of it.**

1. **Volatile means volatile.** Losing `SavedTabPreview` - to a reap, a schema
   change, a cleared profile - breaks nothing, and `dbUpgrade`
   (`src/storage/upgrade.ts`) stays empty for it. The row is worth nothing once
   its tab is gone, and worthless *and wrong* if it is not reaped. A missing
   thumbnail renders as no thumbnail: the placeholder is local (in fact, absent),
   and the hover panel shows the tab's favicon, title and url.

2. **Ownership is session-scoped, then liveness.** Every row records the id of
   the browser run that captured it, kept in `chrome.storage.session` (cleared
   when the browser exits, readable from the worker and from the pages). A row
   whose `sessionId` is not the current one is unowned - which is what turns
   "this tab id is live" into "this *tab* is live", the only reading that is
   safe when chrome recycles ids between runs. `loadPreviews` filters on the same
   id, so a page cannot resurrect an old row before the worker's first sweep.

3. **A row with no open tab is unowned.** `chrome.tabs.query({}`) - every tab in
   every window of the profile, which is what a context that knows nothing about
   any tabverse can and must ask. No age bound: liveness is the whole rule, and
   an age rule would be a second number to argue about.

4. **The worker reaps every five minutes, on a `chrome.alarms` timer** (the
   permission was already declared and unused), created only when absent so a
   worker wake-up cannot push the period out. It also sweeps **once per browser
   run**, at worker start, guarded by the session id: that run is what clears the
   previous run before any page can show it, and the alarm may be minutes away.

5. **The worker owns every delete, and the page keeps the writes.** Its
   `chrome.tabs.onRemoved` / `onDetached` listeners drop a row the moment its
   tab goes, so the common case is exact rather than up to five minutes stale;
   `persistPreview` stays in the page, because a capture is already 80 kB and
   moving it would only add a message to the bus. The in-memory
   `$tabSpacePreviewCache` is the page's and stays there.

6. **The reaper works on keys, never on payloads.** Every step uses primary keys
   and indexed fields and deletes by key, so deciding to drop an 80 kB image
   never costs 80 kB of deserialisation - the constraint that made the original
   page-side version expensive. A test asserts it: the reaper calls none of the
   table's payload-reading entry points.

7. **`MAX_STORED_PREVIEWS` (100) is the only size bound.** Liveness plus a cap is
   enough: a profile holding 300 open tabs would otherwise hold 300 thumbnails,
   and anything older than the current run has already gone by rule 2.

## Consequences

- Schema v10 → v11: `SavedTabPreview` gains an indexed `sessionId`. Rows written
  by an older build have no value there, which makes them unowned by rule 2 -
  the upgrade has nothing to migrate, and `dbUpgrade` stays empty.
- The manager page no longer deletes a preview row; it still drops the tab from
  its own in-memory cache, records the tab in History, and saves the tabverse.
- The reaper never throws: it logs and reports what it did. A sweep that threw
  would take the worker's alarm with it, and the next run would be five minutes
  away.
- The cost of a five-minute timer is the worker being woken twelve times an
  hour. Each wake does one `chrome.tabs.query({})`, a few hundred indexed keys
  and usually nothing to delete; that is the price of "a dead screenshot is gone
  within five minutes" instead of "when a page next happens to start".
- `previewsStayLocal.test.ts` still guards the thing that matters most about this
  table: it is not in the sync layer, so a thumbnail cannot reach a server.