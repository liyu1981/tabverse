# Plan: the toolbar popup (create, search, recent)

Status: built (2026-09). Follows ADR 0008 (search backends) and ADR 0006 (one
tabverse per window, see §2/D8, which ADR 0006 now points back at).

What landed, in the order of §3: `loadTabSpacesByIds` +
`queryRecentSavedTabSpaces` + `countSavedTabSpaces` in
`data/tabSpace/util.ts`; `data/tabSpace/openTabverses.ts`; `src/ui/popup.tsx`
as a `renderPage` bootstrap with the blueprint stylesheets; and
`src/ui/popup/{PopupView,SavedTabSpaceRow}.tsx` + module css. No schema
change, no new permission, and the popup writes nothing.

## 0. What the button does today

`src/ui/popup.tsx` is 20 lines with no UI at all: the `action.default_popup`
page queries the current window and either focuses an existing manager tab or
calls `chrome.tabs.create({url: tabverseUrl(TabSpaceOp.New)})`. So one click
mints a new tabverse id and starts tracking a window, with no way to reach the
ones already saved - the only path to a saved tabverse today is the manager
page's Saved route.

Two constraints that shape the new popup, both already in the code:

- `src/ui/manager.tsx` renders `CountExit("Found another Tabverse Manager
  page!")` and stops when a second manager page exists in the same window. So
  "create a new tabverse" **cannot** mean "new tab in this window" when the
  window already has one; it has to open a window.
- `loadToCurrentWindowUtil` navigates with `window.open(url, '_self')`, which
  in a popup would replace the popup document. The popup needs
  `chrome.tabs.update(activeTabId, {url})` instead.

## 1. Target

```
┌─────────────────────────────────────┐
│ Tabverse                    42 saved│
│ ┌─────────────────────────────────┐ │
│ │        + New tabverse          │ │  primary, full width
│ └─────────────────────────────────┘ │
│ [ search saved tabverses…         ] │  debounced, 200ms
├─────────────────────────────────────┤
│ RECENT                              │  shown while the query is empty
│  Recipes for the week        7 tabs │  name ……… 2 days ago   [↗] [⟳]
│  Java concurrency notes     12 tabs │
│  …                                  │
├─────────────────────────────────────┤
│ 3 results (searched on the sync     │  status line, same wording as
│ server) · show all 42 tabverses     │  the Saved view (ADR 0008)
└─────────────────────────────────────┘
```

- **New tabverse** — one button, always visible, at the top.
- **Search** — one line, results replace the recents while typing.
- **Recent** — the list behind the empty query.
- Every row: name, tab count, relative time, and its actions. Any action
  closes the popup (that is what a popup does).

## 2. Decisions

| # | Question | Decision |
|---|----------|----------|
| D1 | Search input: the tag-style `SearchInput` or a plain line? | **A plain line.** One line → one AND-group with the `anywhere` scope, built with `Query.addAndQuery`, so the whole ADR 0008 dual backend comes for free. The tag UI stays in the manager's Saved view, where it has room. |
| D2 | What makes a tabverse "recent"? | **Last updated** - `SavedTabSpace.updatedAt`, descending. No new field, no Dexie version bump, nothing to stamp. |
| D3 | Who refreshes that timestamp? | **The tabspace bootstrap**, by construction: `tabSpaceBootstrap` calls `saveCurrentTabSpace()` before anything else, so opening a tabverse is what puts it at the top of the recents. No new write, and no change-feed question, because the popup writes nothing at all. |
| D4 | Row actions? | **Open in new window** and **open in this window**, both on every row. Delete stays out of the popup. |
| D5 | The implicit "focus the tabverse in this window" shortcut? | Keep the awareness, drop the side effect: the current window's tabverse is the first row with a "Go to it" action. Opening the popup never moves the user. |
| D6 | What if the window already has a tabverse? | **Warn, then replace in place.** No new window: a confirm dialog says the current tabverse is already saved, that continuing closes it here, and that the window's tabs become part of the new one. Buttons: Cancel / Replace. The old manager tab is closed (or navigated, for D4's "open in this window") *before* the new one opens, because `manager.tsx` bails with `CountExit` when a second manager page exists in a window. |
| D7 | No recents to show? | **Show the empty state.** No "show all" link. |
| D8 | "Open in another window" awareness? | **Yes, in the popup.** The popup can answer it for real: `chrome.tabs.query({})` → every manager page carries its `tvid` in its url (see `tabverseUrl`), so open tabverses are known by id, and a row can be badged "open in N windows" with a Switch action. This reintroduces, in the popup only, something ADR 0006 took away from the manager page - deliberately, and without the leader election that made the old machinery hard: it is one `tabs.query` and a map, with no state to keep consistent. |

## 3. Work items, in order

1. **`queryRecentSavedTabSpaces(limit)`** in `data/tabSpace/util.ts` - scan,
   sort by `updatedAt` desc, cap. Plus `loadTabSpacesByIds` moved there from
   `data/search/index.ts` (it is a tabverse query, and both the search module
   and the recents need it; `data/search` then imports it from `util`, which
   keeps the dependency pointing one way).
2. **Open tabverses map** - `tabsInOtherWindows()`: `chrome.tabs.query({})`,
   keep the manager pages, map `chromeWindowId → {tabId, tabverseId}` from the
   `tvid` query param. Pure function over a tab list, so it is testable.
3. **Popup shell** - `popup.tsx` becomes a bootstrap that calls `renderPage`;
   new `src/ui/popup/PopupView.tsx` + `.module.scss`; import normalize +
   blueprint CSS the way `manager.tsx` does, and pin the body to
   `width: 420px; max-height: 600px` (Chrome's popup ceiling).
4. **Create button** (D5, D6) + the confirm dialog.
5. **Search box** (D1) wired to `searchSavedTabSpaces`, with a monotonic
   request counter so a slow earlier response cannot overwrite a newer one.
6. **Rows and actions** (D4, D8) - "open in new window" via
   `restoreSavedTabSpaceUtil`, "open in this window" by navigating the
   existing manager tab (or creating one), "go to it" for a tabverse open in
   some window.
7. **States**: nothing saved yet (search disabled, create button only), loading
   spinner, "nothing found", the backend status line, and D7's empty state.

## 4. Files

| Path | What |
|------|------|
| `src/ui/popup.tsx` | bootstrap only (renderPage + styles) |
| `src/ui/popup/PopupView.tsx` | header, create button, search, sections |
| `src/ui/popup/SavedTabSpaceRow.tsx` | one row: name, tab count, time, actions |
| `src/ui/popup/popup.scss` | body size, popup-specific overrides |
| `src/data/tabSpace/util.ts` | `queryRecentSavedTabSpaces`, `loadTabSpacesByIds` (moved), `openSavedTabSpaceInWindow` |
| `src/data/tabSpace/openTabverses.ts` | `tvid` parsing + the window → tabverse map (D8) |
| `src/ui/common/SearchInput/*` | untouched (D1 keeps it in the Saved view) |
| `popup.html` | unchanged (already a bare `#root`) |

## 5. Gotchas

- **`window.open(..., '_self')` is unusable from a popup**: it would replace the
  popup document. "Open in this window" navigates the *manager tab* in that
  window instead, which also avoids the close-then-create race of D6.
- **One manager page per window** (ADR 0006 + the `CountExit` guard): both
  "create" and "open in this window" go through the D6 confirm, which is also
  what keeps the user off the "Found another Tabverse Manager page!" page.
- **Navigating the manager tab away leaves its tabverse unsaved only if it was
  never saved** - it is saved on every tab event and once at bootstrap, so the
  D6 warning can honestly say "already saved".
- **The popup runs no change feed** and writes no rows at all (D2/D3).
- **The popup is a page, not the worker**: it has IndexedDB and
  `chrome.storage.local`, so the search module works unchanged; it does not
  need `localStorageInit()` unless it imports a module that reads
  localStorage at import time (`data/bookmark/util` computes a key at module
  scope, which is harmless - it is a pure string function).
- **Popup sizing is a hard Chrome limit** (≤800×600); content must scroll, and
  the recents list is capped (10) for that reason as well as for speed.
- **`window.close()` after every action**, including a failed one, so the user
  is not left staring at a dead popup.
- No new permission is needed: `tabs` and `storage` are already declared.

## 6. Tests

The repo has no component-test setup (no testing-library), so the coverage is
logic-level, in the shape of the existing tests:

- `data/tabSpace/__tests__/recent.test.ts` — recents ordering by `updatedAt`,
  the cap, per-tabverse isolation.
- `data/tabSpace/__tests__/openTabverses.test.ts` — `tvid` parsing, a tab that
  is not a manager page, several windows, the same tabverse in two windows.
- A pure helper for the D5/D6 branch (`planOpenInWindow(hasTabverse)` → `create
  | confirm | navigate`) so the "second manager page" trap is covered by a test
  rather than by clicking it.
- `data/search` already covers both search backends; no new search test is
  needed for D1 beyond asserting the line becomes one AND-group.

## 7. Follow-ups this opens

- ADR 0006 §1 removed cross-window switching from the manager page because the
  data was not available. D8 re-adds it in the popup, where it is. That is a
  deliberate exception, and ADR 0006 should point at this document so the next
  reader does not read the two as a contradiction.
- The Saved view in the manager page still owns delete and still sorts by
  created/saved time; nothing here changes it.
