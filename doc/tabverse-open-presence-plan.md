# Plan: the tabverses open in this browser (list them, switch to them, never duplicate them)

Status: **built** (2026-10), except the two items §6 marks as user's eyes only.
Extension only - **no server change, no sync change**. Follows `adr/0006` (one tabverse per window) and the popup plan (D8,
which put cross-window awareness in the popup and nowhere else).

Supersedes the earlier draft of this document, which proposed syncing presence to
the server. That is cut; §11 says why, and keeps the reasoning.

## 0. What this is

One question, asked by the tabverse you are looking at: **which other tabverses
are open in this browser right now?** Three answers, all local:

1. the sidebar's "Current Tabverse" entry shows this window's tabverse by name,
   and one entry per other window switches to the tabverse that window holds;
2. opening a tabverse that is already open **goes to it** instead of opening a
   second copy - a duplicate is not cosmetic, see §3;
3. the Saved view's "opened" badge and buttons stop being wrong: a tabverse open
   in another window offers *Switch*, not *Load to New*.

Scope is **one Chrome profile**. A second profile is a second extension install
with its own IndexedDB, and `chrome.tabs.query` in profile A cannot see profile
B's tabs at all, so "open in this browser" is exactly as far as this reaches
(§11).

## 1. Where we are

Already there, and used as is:

- `src/data/tabSpace/openTabverses.ts` (123 LOC, tested): `openTabSpacesOf` reads
  every open Tabverse tab's `tvid` and window id out of `chrome.tabs.query({})`,
  `queryOpenTabSpaces` wraps it, `switchToOpenTabSpace` activates a tab and
  focuses its window. The popup's rows already switch this way.
- `src/data/tabSpace/util.ts`: `loadTabSpacesByIds`, which answers "what is this
  tabverse called and how many tabs does it have" for a set of ids in two
  `bulkGet`s.
- **Every tabverse has a name in IndexedDB from its first second.**
  `tabSpaceBootstrap` writes `name: \`Window-${chromeWindowId}\`` and saves
  before `scanCurrentTabs`, "so a crash in the first second cannot lose the
  tabverse". A user rename persists. So the name never has to be invented.

Two things were wrong, and both are now fixed (marked *built* below):

| # | Problem | Why it hurts |
|---|---------|--------------|
| 1 | `openedSavedTabSpaces` in `data/tabSpaceQuery/store.ts` was a hardcoded **one-element** array holding this window's own tabverse, commented "a manager page only ever owns the tabverse of its own window" | every other window's tabverse was drawn as *not opened*, so the detail view offered **Load to New** - which opens the duplicate |
| 2 | `restoreSavedTabSpaceUtil` created a window unconditionally | the one remaining programmatic door to a duplicate; the popup's "open in new window" button goes through it |

## 2. The shape of it

```
 manager page (window 1)                manager page (window 2)
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ Current Tabverse             │        │ Current Tabverse             │
│   Recipes for the week       │        │   Java concurrency notes     │
│ Other Tabverses              │        │ Other Tabverses              │
│   Java concurrency notes ────┼ click ─┼──▶  Recipes for the week       │
│                              │        │                              │
│ Saved Tabverses              │        │ Saved Tabverses              │
└──────────────────────────────┘        └──────────────────────────────┘
 collapsed (the rail):
│ [panel-table] Recipes for the week │   ← tooltip = the tabverse's name
│ [th-derived]  Java concurrency notes│
│ [git-repo]    Saved Tabverses     │
        │                                       │
        └──────────► chrome.tabs.query({}) ◄─────┘   (one call, per page)
                          │
                          ├─ tvid        → which tabverse
                          ├─ windowId    → which window (and is it mine?)
                          └─ chromeTabId → what to activate
                                   │
                     IndexedDB: the name, by tvid
```

## 3. Why a duplicate has to be prevented, not just discouraged

Two Tabverse tabs with the same `tvid` are two pages holding one id. Both
autosave: `saveCurrentTabSpace` writes the `SavedTabSpace` row keyed by that id,
on every tab event. So the two windows **overwrite each other's `tabIds`** - the
tabverse's tab list flip-flops between them, and with it the tab list, the
History tool, and (through the change feed) every other device. Nothing warns
about it; it just corrupts quietly.

The `CountExit` guard in `manager.tsx` does not help: it fires for two manager
pages **in one window**, and this is two windows.

So the rule is at the door, not in the UI: `openOrSwitchToTabSpace` asks
`queryOpenTabSpaces()` and switches when the answer is yes. It cannot be a UI
convention, because the popup, the Saved view and a future caller all reach the
same door.

## 4. Decisions

| # | Question | Decision | Why |
|---|----------|----------|-----|
| D1 | Where does "which tabverses are open" come from? | `chrome.tabs.query({})`, once, in each page that draws the list | Exact, instant, offline, and unpaired (ADR 0002 §2). It is also the only source that can say *which window*, which is what makes the switch one call. |
| D2 | Where does the name come from? | IndexedDB, via `loadTabSpacesByIds`, joined on the id from the query | `tabSpaceBootstrap` saves `Window-<id>` before the first tab event, so the row exists; a rename is already live across pages (`localTables.ts` lists `SavedTabSpace` in `NOTIFY_TABLES`). No server, no round trip. |
| D3 | Is the name the identity? | **No.** Identity is the live `tvid` + `windowId`; the name is a label | The *default* name is `Window-3`, and `tab.windowId` changes when a tab is dragged to another window, so the stored name goes stale while the query stays right. |
| D4 | A tabverse whose row is not in IndexedDB yet? | It stays in the list, with an empty name and no count | `loadTabSpacesByIds` **drops** ids it cannot find. Building rows from the *window query* and decorating them with the name is the only order that cannot empty the list; a row that vanishes because a name is late is worse than a row with no name. |
| D5 | What does one click do? | The popup's existing action: `tabs.update(active)` + `windows.update(focused)` | It cannot lose anything and needs no confirmation. |
| D6 | How is a duplicate prevented? | One chokepoint, `openOrSwitchToTabSpace`, used by `restoreSavedTabSpaceUtil` | §3. A UI convention would be bypassed by the next caller. |
| D7 | What about "Load to Current"? | Unchanged, and unreachable for an open tabverse | The detail view already hides Load-to-New/Load-to-Current when the tabverse is `opened`; once "opened" means *this profile*, that hiding is correct. An explicit in-place replacement stays available for a tabverse that is closed. |
| D8 | Does the popup change? | No. It already switches, and its rows now hit the chokepoint through `restoreSavedTabSpaceUtil` | Its `open in new window` button is the duplicate door; the door is fixed, so the button is now "go there if it is already there". Its tooltip should say so. |
| D9 | Refresh cadence in the page | The page listens itself: `tabs.onCreated/onUpdated/onRemoved/onAttached/onDetached`, `windows.onRemoved/onFocusChanged`, debounced ~250 ms, plus a reload of the query store | `startMonitorTabChanges()` already registers the tab listeners, so the events are there. No worker→page message: the worker is asleep most of the time, and a manager page is the only thing that draws this list. |
| D10 | A tabverse open in two windows (already possible, from an older build) | Both rows are drawn, one per window; switching goes to the first | One row per *window* is the truth. Hiding the second would hide a real window. The prevention in D6 stops new duplicates; it does not pretend old ones are not there. |
| D11 | Scope | One Chrome profile | A profile cannot see another profile's tabs. Stated in §0 rather than discovered later. |
| D12 | Server / sync | **Untouched.** No endpoint, no entity, no `updated_at`, no LWW | §11. |

## 5. Built (verified by tests)

| Piece | Where |
|-------|-------|
| `otherWindowTabSpaces(openTabSpaces, self)` - the pure filter (own window and own id out, window order kept) | `src/data/tabSpace/openTabverses.ts` |
| `planOpenTabSpace` + `openOrSwitchToTabSpace` - the chokepoint, with injected `query` / `switchTo` / `create` | `src/data/tabSpace/openTabverses.ts` |
| `restoreSavedTabSpaceUtil` routes through the chokepoint | `src/data/tabSpace/chromeUtil.ts` |
| `openedSavedTabSpaces` is now every tabverse open in this profile; `OpenedTabSpace` narrowed to "is it open, and where" | `src/data/tabSpaceQuery/store.ts`, `TabSpaceQuery.ts` |
| "Switch to Tabverse" switches to the **target's** window, not this one's | `src/ui/manager/SavedTabSpace/SavedTabSpaceView.tsx` |
| The page-side store, the monitor and the join: `$openTabSpaces` → `$otherWindowTabSpaces` → `$otherWindowRows`, `refreshOpenTabSpaces`, `startMonitorOpenTabSpaces` | `src/data/tabSpace/openWindowStore.ts` |
| The monitor starts with the page | `src/data/tabSpaceBootstrap.ts` |
| The sidebar: "Current Tabverse" (its name, truncated) and one entry per other window, each switching to the tabverse that window holds | `src/ui/manager/Sidebar/Sidebar.tsx`, `LiveTabSpace.tsx`, `OtherTabSpaces.tsx` |
| The Saved view re-reads when the open set changes | `src/ui/manager/SavedTabSpace/SavedTabSpaceView.tsx` |
| The popup's window button says it will switch when the tabverse is open | `src/ui/popup/SavedTabSpaceRow.tsx` |
| The mock resolves relative urls like Chrome does, and grew `windows.create` / `windows.update` / `removeListener` | `src/dev/chromeMock.ts` |
| A paragraph next to the live tab filter | `ARCHITECTURE.md` |

The sidebar has **two renderings of one list**, and making the other windows
sidebar *entries* is what makes the second one free: expanded, each is a row
showing the tabverse's name (truncated, full name in `title`); collapsed, the rail
has no room for text, so the same entries are `th-derived` icons with that name
as their tooltip and accessible name. The tab count is deliberately not in the
sidebar: a name is what a person recognises a tabverse by, and the row is a
switch, not a summary. `OtherTabSpaces.test.tsx` asserts both shapes.

Three things the tests found, all worth keeping written down:

- **`chrome.tabs.create({url: 'manager.html?...'})` used to store the relative
  url**, so `isTabSpaceManagerPage` never matched a Tabverse tab opened through
  the chrome APIs: the tab existed and could not be found. The duplicate
  test failed on exactly that.
- **`logger.error` is silent under the test log level** (`debug.ts` defaults to
  `ERROR + 1`), so a swallowed exception looks like an empty list. The test file
  now calls `setDebugLogLevel(TabSpaceLogLevel.LOG)`; without that, a missing
  declaration in `openWindowStore` presented as "the names did not load".
- **`pubsub-js` delivers asynchronously here**, so the monitor test must
  `await mockChrome.flushMessages()` like every other mock test - and the mock's
  listenables had no `removeListener`, which meant a stopped monitor kept
  reacting.

## 6. Not done here

- **Nothing in a browser.** Every assertion above is a unit test or static
  markup; what the group looks like, and whether one click lands on the right
  window, is §9's job and the user's.
- **The refresh trigger for the Saved view fires per monitor tick** (D9). If the
  list ever feels expensive, the next step is to skip the reload while the Saved
  route is not the active one.

## 7. Gotchas

- **A window id is not a label.** `tab.windowId` changes when a tab is dragged to
  another window, and the default name `Window-<id>` is written once. Show the
  name; use the id only to compare.
- **`loadTabSpacesByIds` drops what it cannot find** (D4). Build rows from the
  window query, decorate from IndexedDB - never the other way round.
- **Chrome resolves a relative url against the extension origin.** The mock got
  this wrong and the duplicate check silently found nothing (§5).
- **Two manager pages, two windows, one id = silent corruption** (§3). The
  chokepoint is the only thing standing between a user and that; a test that
  calls `restoreSavedTabSpaceUtil` twice is worth keeping for that reason.
- **`OpenedTabSpace` is only "is it open, and where"** - `id`,
  `chromeTabId`, `chromeWindowId`. It carries no name and no timestamps on
  purpose: a tabverse whose row is not written yet has no honest value for
  either, and nothing reads them (the detail view takes the name from the saved
  row the list already loaded). An earlier draft had `createdAt: -1` sentinels
  that `SavedTabSpaceDetail`'s created/saved lines would have formatted as 1969.
- **The sidebar's rail.** `SidebarComponent` renders children only when the entry
  is active and the sidebar is not collapsed, so the group is free when
  collapsed - but the store subscription still runs. Hence the debounce.

## 8. Tests

| Suite | What it pins |
|-------|---------------|
| `src/data/tabSpace/__tests__/otherWindows.test.ts` | the query gives id + window + tab for every open tabverse; the filter excludes own window and own id; the same tabverse in two windows; the name/count join; the missing-row case; `planOpenTabSpace`; the chokepoint with fakes; **twice = one window** |
| `src/data/tabSpaceQuery/__tests__/store.test.ts` | `openedSavedTabSpaces` spans windows, carries the neighbour's window and tab, and `isTabSpaceOpened` says yes; an open tabverse with no saved row is still listed |
| `src/ui/manager/Sidebar/__tests__/LiveTabSpace.test.tsx` | `renderToStaticMarkup`: no group when empty, a row with name and count when not |

Ran for the built part: `pnpm test` (73 files, 446 tests), `pnpm run typecheck`,
`biome check` on every touched file. Not run: anything in a browser (§9).

## 9. What the user should check

Nothing here is verified in Chrome by me; `AGENTS.md` forbids driving a headless
browser for it. Once (1)-(3) land:

1. Two windows, each with a tabverse → each sidebar lists the other, with the
   right name and tab count; `locate` brings that window forward on its Tabverse
   tab.
2. The Saved view in window 1 shows window 2's tabverse as **opened**, with only
   *Switch to Tabverse*.
3. Ask for an already-open tabverse from the popup twice → one window, and the
   second click comes to the foreground instead of opening anything.
4. Drag a Tabverse tab into another window → the list follows it (the live window
   id), even though the stored name still says `Window-1`.
5. Unpaired, airplane mode → all of the above still works, and nothing is sent.

## 10. Cost

Extension only: one pure function, one chokepoint, one store field, one button's
target, one monitor, one sidebar group. Server, sync layer, protocol, manifest
and permissions: untouched. `ADR 0006` is not contradicted - it removed the
registry and said the data was unavailable *then*; §1 of the popup plan is the
same observation one release later, and this is that observation applied to the
sidebar.

## 11. Cut: presence on the server

The earlier draft of this plan synced "which tabverses are open" to the server
(`PUT/GET/DELETE /api/v1/presence`, an in-memory lease with a TTL). It is cut,
and the reasoning is worth keeping:

- **It does not serve this feature.** "Other window" means a window on this
  device. `chrome.tabs.query({})` answers that exactly; the server could only
  answer it later and worse.
- **A record cannot hold it.** `records` is keyed `(user_id, entity, id)` with
  LWW on the client's `updated_at`: one value per tabverse, while presence is
  per *device*. Two machines with one tabverse open fight over the row, an
  unrelated rename on one clobbers the other's `open: true`, and a crash leaves
  `open: true` as a permanent fact about the user's data - which ADR 0002 §3's
  "upload local data" default then re-pushes to every new device. A lease
  expires by itself; a record never does.
- **`windowId` is session-scoped and is deliberately not synced.**
  `convertAndGetTabSpaceSavePayload` builds the payload as
  `{...savedBase, name, tabIds, tabGroups}` - `chromeTabId` and `chromeWindowId`
  stay out, the same rule as `chrome.tabGroups` ids and `splitViewId`.
- **A profile cannot see another profile anyway** (D11), so the server's
  audience would be other *devices*, which is a different feature with a
  different honest answer: a stale-by-3-minutes row whose action is not "focus
  a window".

If that feature is ever wanted: an in-memory lease on the server, three
endpoints, a TTL, and no record - and it buys cross-device awareness, nothing
more.