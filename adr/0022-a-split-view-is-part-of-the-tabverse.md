# ADR 0022: a split view is part of the saved tabverse

Status: accepted (2026-10)

Extends [ADR 0016](0016-tab-previews-are-a-cache.md) (a session-scoped id is
not stored), [ADR 0019](0019-the-tabverse-view-is-shared.md) (one
`tabverseEntries`, drawn by both pages) and, through it,
[ADR 0001](0001-server-authoritative-sync.md) (the record is the user's data).

Plan: none; this came out of the console showing a synced tabverse with every
tab and no layout.

## Context

A split view is the two tabs Chrome shows side by side. The extension draws it —
`tabverseEntries` emits a `split` entry and `SplitBlock` labels it — but only
for a tabverse **open in this browser**, because the pairing lived in
`Tab.splitViewId` and that field is deliberately not part of `TabCore`:

> Chrome's Split View id ... Session scoped like `chromeTabId`, so it is
> deliberately *not* part of TabCore and never synced.

So the pairing was not saved. `fromSavedTab` returns `TabCore`, which has no
`splitViewId`, which meant:

- a tabverse read back off disk after a reload drew a flat list;
- the console's drawer, which draws from the record, drew a flat list;
- ADR 0019 said so as a known price, and kept importing `SplitBlock` "because
  the day a tabverse records a split, both pages should show it".

Groups never had this problem: `tabGroups` lives in the tabverse payload, so a
group survives a reload and shows up in the console. A split did not, which is
why the report reads as "the tabs are the same, splits are all gone".

One thing made the fix tempting and dangerous at the same time. `listLocalRecords`
uploads `JSON.stringify(row)` — the whole Dexie row, live fields included — so
`splitViewId` was **already on the server**, in the tab record's payload, with
nothing reading it. The comment above was wrong about the wire. But reading it
there would have been wrong in a different way: `splitViewId` is scoped to the
browser session that issued it, so a second device on the same account has its
own "split view 7", and the console would draw four unrelated tabs as two pairs.
The split commit that introduced the field noticed the leak and deferred it as
"a change at the sync boundary with its own blast radius".

## Decision

**The pairing is saved and synced, as the partner's tab id.**

1. **`TabCore.splitWith?: string`** — the id of the other tab in this tab's
   split view. It is a `TabCore` field, so it is in the saved row, in the synced
   payload, and in the tabverse the console draws. Not `splitViewId`: a tab id
   means the same thing on every device, and a Chrome id does not.

2. **Chrome's answer is a tri-state, and all three cases mean different things.**
   `Tab.splitViewId` carries `SPLIT_VIEW_ID_NONE` through verbatim, and
   `withSplitPartners` - in `convertAndGetTabSpaceSavePayload`, where the whole
   tab list is in hand - reads it as:

   - a split view id → the pairing is that partner's tab id;
   - `SPLIT_VIEW_ID_NONE` → chrome says the tab is in no split, so **the pairing
     is dropped**: a closed split retires itself;
   - nothing at all → **the row keeps the pairing it has.** A browser before 140
     cannot answer, and neither can a tab that is not in a window - a tabverse
     restored from disk, or a row the console read.

   The third case is the one that needed care. `copyChromeTabFields` used to map
   `SPLIT_VIEW_ID_NONE` to `undefined`, which made "chrome says there is no split"
   and "chrome has no opinion" the same absence, and the first must be believed
   while the second must not. Collapsing them is why the first version of this
   could not retire a closed split at all.

3. **A periodic rescan, because "chrome told us once" is not a guarantee.** A
   split view is the one piece of layout that can end without the tabverse
   changing shape: the user closes it and both tabs stay exactly where they are.
   The event path normally hears about it - `onUpdated` carries the change, and a
   changed split view id is not a metadata-only change, so it saves - but a
   frozen tabverse page, a sleeping worker, or a coalesced event all lose it, and
   nothing else would ever ask again.

   So `refreshSplitViews` (started from `tabSpaceBootstrap`, `splitView.ts`) asks
   chrome what is *true now* for the tabs in this window, once a minute. It is
   deliberately the narrowest scan in the extension: one field, live tabs only,
   nothing else touched - a general rescan would fight the event path over the
   titles and favicons of tabs that are still loading, which is the mistake
   `copyChromeTabFields` exists to avoid. It corrects the store and lets the
   ordinary debounced save carry it to the record.

4. **Drawing prefers the recorded partner.** `findSplitPartner` answers from
   `splitWith` when it names a tab that is present, and falls back to scanning
   `splitViewId` otherwise — which is all a live tabverse has until it is saved,
   and what a tab whose recorded partner has since been deleted falls back to.
   `findSplitPartnerByChromeId` refuses `SPLIT_VIEW_ID_NONE` outright: the partner
   is found by matching ids, and every unsplit tab in the window shares the same
   -1.

5. **A split is presented, not recreated.** `SplitBlock` draws the pair in both
   the saved view and the console. Restoring a tabverse opens its tabs flat,
   because creating a split view is not something the extension can ask Chrome
   for yet. Nothing in this change claims otherwise.

## Consequences

- **A saved tabverse and the console now agree** with the window, which is the
  point: the same `tabverseEntries` draws a split whether the pairing came from
  Chrome or from the record.
- **Closing a split converges within a minute**, not immediately: the rescan
  corrects the store and the debounced save writes it, so the record follows
  shortly after. Until it does, the list still draws the layout the record last
  agreed to. That is the cost of not trusting an event stream to be complete.
- **The rescan runs per tabverse page, not in the worker.** The state it corrects
  is the page's in-memory tabverse, so a worker would have to message it anyway;
  and Chrome already clamps a hidden tab's timers to about once a minute, which
  is the cadence wanted here. Nothing to tear down: a module interval dies with
  its document.
- **A tabverse shows its splits in the console after its next save.** Existing
  rows carry only `splitViewId`, which is deliberately not read; the pairing is
  written the next time that tabverse is saved by the extension.
- **`chromeTabId` and `chromeWindowId` are still on the wire.** `listLocalRecords`
  uploads whole rows, so one device's Chrome ids are still in another device's
  rows. The same change that makes `splitWith` deliberate would fix that, but it
  means deciding what the payload of each entity is, which is a bigger change
  than this one and is not needed for the split to be right. Left for its own ADR.
- **Restoring will need one line when Chrome allows creating splits:** carry
  `splitWith` into the restore and pair the two tabs. The split view then exists
  in the window, and `scanRestoredWindow`'s read-back gives every tab a live
  answer again - which is the whole reason the "no answer" case is separate from
  the "not a split" one.
- Nothing here is verified by a browser. What the user should look at: a tabverse
  with a split, saved and synced, drawn as a split block in the console's drawer
  — and the split inside a group drawn inside the group; then a split closed in
  Chrome, and the block gone from the list a minute later.