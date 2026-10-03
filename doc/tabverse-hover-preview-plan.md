# Plan: hover a tabverse, see its tabs

Status: **built** (2026-10), then revised: the panel also previews in the collapsed
rail (§10.4), it is styled as the tab preview panel rather than its own thing
(§10.5), and one radius now covers it, the tab preview and the four right side
tools (§10.6). Extension only - no server change, no sync change, no
schema change. Follows the presence work
(`doc/tabverse-open-presence-plan.md`), whose rows this previews, and `adr/0016`
(tab previews are a cache).

Two things the build changed against the plan, both recorded in §10.

## 0. What is being asked

In the left sidebar, hovering one of the **Other Tabverses** rows for a second
pops up a small preview: the first few tabs of that tabverse, so a person can
tell two similarly named tabverses apart without switching to them.

The interaction is not new. `TabCard` already does it one level down, for a
*tab*: a Blueprint `Popover` with `interactionKind="hover"` and
`hoverOpenDelay={800}` (`src/ui/manager/TabSpace/TabCard.tsx:223`). This plan is
the same hover, one level up, with a list instead of a screenshot.

## 1. Where we are

- **The rows exist** (`src/ui/manager/Sidebar/OtherTabSpaces.tsx`): one sidebar
  entry per other window, labelled with the tabverse's name, clicking switches to
  it. `OtherTabSpaceRow` is `{tabSpaceId, chromeTabId, chromeWindowId}` plus a
  name and a tab count (`$otherWindowRows` in `data/tabSpace/openWindowStore.ts`).
- **The hover pattern and its delay are proven** (`TabCard.tsx`), including the
  three props that matter for a read-only panel: `autoFocus={false}`,
  `enforceFocus={false}`, `portalClassName` (so the popover is not clipped by the
  sidebar's own stacking).
- **The tab data is available twice over**, which is the one real decision:
  - the tabverse's own saved rows (IndexedDB `SavedTabSpace.tabIds` +
    `SavedTab`), which `loadTabSpacesByIds` already reads on every open-set
    change; and
  - `chrome.tabs.query({ windowId })`, which is that window's tabs as they are
    *now* - strip order, `pinned`, and a live `chromeTabId`.
- **Thumbnails are keyed by `chromeTabId`** (`data/tabSpace/tabPreviewStore.ts`),
  which the saved rows deliberately do not carry: session-scoped ids are never
  stored or synced (`adr/0006`, `convertAndGetTabSpaceSavePayload`). So a
  thumbnail is reachable only through the live query.

## 2. The shape of it

```
┌─ sidebar ──────────────┐
│ Current Tabverse       │
│   Recipes for the week │
│ Other Tabverses        │
│   Java concurrency  ⋯⋯ │   ← pointer rests here
│   ░░░░░░░░░░░░░░░░░░░░ │   ┌──────────────────────────────┐
│   ░░ 1s later ░░░░░░░░ │   │ Java concurrency notes       │
│   ░░░░░░░░░░░░░░░░░░░░ │   │ 12 tabs · 2 groups           │
└─────────────────────────┘   │ ◇ github.com/foo/bar         │
                              │ ◇ docs.python.org/3/ref      │
                              │ ◇ news.ycombinator.com       │
                              │ + 9 more                     │
                              └──────────────────────────────┘
```

## 3. Decisions

| # | Question | Decision | Why |
|---|----------|----------|-----|
| D1 | How is the hover delayed? | Blueprint's own `hoverOpenDelay={1000}` on the row's popover, with `interactionKind="hover"` (not `hover-target`) | The delay is then the same mechanism the tab cards use (`TabCard.tsx`), with none of the timer/cancel bookkeeping: Blueprint has no `NONE` interaction kind, so there is nothing to drive by hand. `hover` rather than `hover-target` is what keeps the panel open while the pointer is *on* it - a list invites the pointer to travel in, and `hover-target` would close it at the panel's edge. `hoverCloseDelay` defaults to 300 ms, which is enough; the plan sets it explicitly rather than relying on the default. |
| D2 | **Where do the tabs come from?** | **`chrome.tabs.query({ windowId })` for that row's window**, read on hover, cached per window for the page's life. Manager pages filtered out (`isTabSpaceManagerPage`), so the tabverse's own tab is not listed. | A preview is a claim about the window *now*, and only the live query can keep it: it carries the strip order (which is the tabverse's order by construction), `pinned`, and the `chromeTabId` a thumbnail would need. The saved rows are up to a save-debounce behind and have no ids. Cost is one query per hover on an already-idle pointer, over a handful of tabs. |
| D3 | Why not the saved rows, which are already loaded? | Only for instant content, not as the source | They are the right answer for "what would be restored", the wrong answer for "what is in that window". Using both would mean two code paths that can disagree. |
| D4 | How many tabs? | **4**, then a `+N more` line; the header carries the name and `N tabs` | Four is what fits beside a 320px sidebar without the popover becoming a second tab list. The count is already in the row's data. |
| D5 | Is the panel interactive? | **No.** No close, no switch, no bookmark | A saved tab carries `chromeTabId: -1`, and ADR 0019 already had to add that guard to `TabCard` after a dead button reached the console. A row in a *live* tabverse would need chrome calls per row, and the panel's job is to identify the tabverse, not to be another place to manage tabs. The row's own click still switches. |
| D6 | Thumbnails? | **Not in this increment.** Each row shows `FavIcon` + title + url, like the live tab list | A thumbnail needs the `chromeTabId` (D2 provides it) and then depends on the cache having an entry - ADR 0016's rule is that a cache entry is never a promise, and the honest fallback is the "Preview Not Yet Generated" box. That is a second increment with its own measurement, not a detail. |
| D7 | Favicons are remote - is that allowed? | Yes, and it is what the live list already does | ADR 0016's rule is about *screenshots* ("a tab's picture must never leave the machine"). A favicon URL is fetched by Chrome for those tabs anyway, and `FavIcon` is already in the tabverse list. `FavIcon`'s `dummyimage.com` fallback does remain a third-party fetch for a tab with no icon - pre-existing, and worth its own fix. |
| D8 | Keyboard and touch? | **Not in this increment.** The popover is pointer-only; the row's accessible name is still the tabverse name | Blueprint's hover popover does not open on focus, and a focus-triggered panel that follows the pointer is worse than none. Nothing is lost: the row's action is a click, and the preview only saves a switch. |
| D9 | Where does the popover target sit? | Around the row's header content, inside the existing `<button>` | The row is already a button (`SidebarComponent`'s header). Blueprint wraps the target in a `<span>` and portals the content out, so what lands inside the button is a non-interactive span - valid, and no change to the row's markup contract. |
| D10 | Placement and width? | `placement="right"`, `fill={false}`, ~340px, the extension's card styling | Right of the sidebar is the only side with room. |
| D11 | Freshness | Nothing extra: the preview is read on hover, so it cannot be stale by more than the hover | The *row* (name, count) keeps coming from the store as it does now. This deliberately does not extend the store to carry tab lists - that would mean reading and holding every open tabverse's tabs to answer a question asked once a minute. |
| D12 | Does the current tabverse get one too? | No | Its tabs are the ones already on screen in this window. |

## 4. Work items, in order

1. **`previewTabsOfWindow(tabs, limit)`** in
   `src/data/tabSpace/openWindowStore.ts` (or a sibling `tabversePreview.ts`): a
   pure function over a tab list - drop manager pages, keep strip order, cap at
   `limit`. Pure, so the existing mock fixtures are the fixtures.
2. **`TabverseHoverPreview.tsx`** (new, in `Sidebar/`): the panel - header
   (name, `N tabs`), up to four rows of `FavIcon` + title + url, the `+N more`
   line, and the empty case ("no tabs saved yet"). Non-interactive.
3. **`OtherTabSpaces.tsx`**: wrap each row's header content in a `Popover` with
   `interactionKind="hover"`, `hoverOpenDelay={1000}`, `hoverCloseDelay={300}`,
   `autoFocus={false}`, `enforceFocus={false}`, `placement="right"`, and the
   content built from the last read of that window. The content is a React
   element, so the read happens in the panel's own effect on open - Blueprint
   mounts it only while the popover is open - and the "last read" is a module
   level `Map<windowId, TabversePreview>` so two hovers in a row do not query
   twice.
4. **Styles**: import `TabCard.module.scss`'s preview classes rather than
   transcribing them - the same reuse ADR 0019 established for the console, and
   it is what makes the two previews look like one feature. A css module's hashed
   names cannot come through `@use`, so the reuse is in the component
   (`import tabCardClasses from '../TabSpace/TabCard.module.scss'`), and a test
   asserts the keys resolve: a missing key is `undefined` at runtime and fails
   silently.
5. **The panel's own module scss** for what the tab card's classes do not cover
   (the `+N more` line, the row spacing).

## 5. Files

| Path | What |
|------|------|
| `src/ui/manager/Sidebar/OtherTabSpaces.tsx` | the popover on each row |
| `src/ui/manager/Sidebar/TabverseHoverPreview.tsx` | the panel |
| `src/ui/manager/Sidebar/TabverseHoverPreview.module.scss` | its own styles |
| `src/data/tabSpace/openWindowStore.ts` | `previewTabsOfWindow` (pure) |
| `src/ui/manager/TabSpace/TabCard.module.scss` | read only, for the shared preview classes |
| `src/ui/manager/Sidebar/Sidebar.tsx` | `wrapHeader` on `SidebarComponent` (§10.2) |
| `src/ui/manager/Sidebar/__tests__/previewTabs.test.ts`, `TabverseHoverPreview.test.tsx` | the data and the markup |
| `ARCHITECTURE.md` | a sentence under the other-tabverses paragraph |

## 6. Gotchas

- **The row is a `<button>`.** The popover's target span and any hover handlers
  live inside it. Valid (a span with no interactive content), but a
  `Popover` configured as interactive would put focusable content inside a
  button - which is why D5 says the panel is read-only and D9 says `autoFocus`
  and `enforceFocus` are false.
- **The sidebar's stacking.** `TabCard` already passes `portalClassName` for
  this; without it the popover is clipped by the sidebar's own stacking context.
- **A window with no tabverse tabs** renders the empty line, not an empty box.
- **A row whose tabverse id has no saved row** (its window opened a moment ago)
  still gets a preview - from the live query, which does not need the saved row
  at all. That is the one place D2 is plainly better than D3.
- **FavIcon's fallback** fetches `dummyimage.com` for a tab with no icon. Pre-
  existing in the live list; do not copy it into a new component if the fix
  lands first.
- **Chrome's `tabs.query` on another window** needs the `tabs` permission, which
  is already declared - no manifest change.

## 7. Tests

| Suite | What it pins |
|-------|---------------|
| `Sidebar/__tests__/previewTabs.test.ts` | manager pages dropped; strip order kept; the cap; a window with nothing in it |
| `Sidebar/__tests__/TabverseHoverPreview.test.tsx` | `renderToStaticMarkup`: the header counts, four rows and a `+N more`, the empty case, and that there is no button in the panel (D5) |
| `Sidebar/__tests__/OtherTabSpaces.test.tsx` (extended) | the popover target is on each row, and the collapsed rail does not grow one |

The repo has no component-test setup, so this is static markup plus pure
functions - the shape ADR 0019 established.

## 8. Verification

`pnpm test`, `pnpm run typecheck`, `lint:check`, `format:check`, `build`. **No
browser** (AGENTS.md): what to look at is

1. hover an Other Tabverses row, move the pointer away immediately → nothing
   appears (1s is the point);
2. rest for a second → the panel, with the right tabverse's first tabs in strip
   order;
3. move the pointer into the panel and slightly out → it does not flicker;
4. click the row → the panel is gone and the window switched;
5. collapse the sidebar → no popover on the rail;
6. with two windows showing near-identical names → the panel is what tells them
   apart.

## 9. Not in this increment

- **Thumbnails per row** (D6): reachable once D2's `chromeTabId` is used against
  `tabPreviewStore`, with ADR 0016's "not yet generated" fallback.
- **Keyboard/focus opening** (D8).
- **A preview of the current tabverse** (D12).
- **Group blocks in the panel**: the tabverse's groups are in the saved row, not
  in the live query, so a panel that showed them would be mixing sources - the
  same reason D3 was rejected.

## 10. Where the build differed from the plan

1. **The read lives in the panel, not in the row** (D2, D11 unchanged). Blueprint
   mounts popover content only while the popover is open, so the component that
   queries exists only for the second the panel is up - no state, no cache to
   invalidate, and the query cannot run for a panel nobody opened. The
   `Map<windowId, TabversePreview>` is kept only so hovering away and back does
   not query twice.
2. **The popover target is the row's button, not the content inside it** (D9
   corrected). Blueprint gives its target `tabindex="0"` and `aria-haspopup`, and
   the row is a `<button>`, so a target inside it would be focusable content
   nested in a button - invalid HTML and a second tab stop. `SidebarComponent`
   grew an optional `wrapHeader(button)` for exactly this, applied only while the
   sidebar is expanded. A test asserts the wrapper lands on the button, and that
   the rail does not get one - which is asserted by the *absence* of
   `aria-haspopup`, since the rail's tooltip is also a `bp6-popover-target`.
3. **The panel says "reading…" before its read lands**, rather than showing zero
   tabs. The read is a few milliseconds, but "0 tabs" would be a lie the user
   could act on.
4. **The rail previews too** (D8 revised). `SidebarComponent` prefers
   `wrapHeader` over the collapsed rail's `Tooltip`, in both states: the panel's
   header carries the tabverse name, so it says everything the tooltip said, and a
   popover inside a tooltip would be two overlays for one hover. The rail's
   icons cannot name their tabverse, which is the whole question there.
5. **The panel is the tab preview panel, not a second one** (D6, D10 revised). It
   already reused that panel's classes; what differed was its radius, which was
   its own 12px against the preview's 38px pill. There is now one radius.
6. **One radius for row and card surfaces** (`global.$radius-card`, 12px - the tab
   list row's own value, which was the only one of these that matched nothing
   else). Applied to: the tab list row and the tab preview panel (were 38px), the
   hover panel, and the four right side tools with their container and the note
   editor (were 18px - uniform already, but uniform at the wrong value).
   Deliberately left alone: the sidebar's own card (20px - it is the frame the
   rows sit in, not a row), the toolbar pill (20px), the dialogs (18px, a
   different object), and the small controls inside a row (3-10px).
7. **Its gap from the row is a css margin, and its radius needed the inner
   surface** (D10). Two findings, both from looking at the panel in a browser
   rather than at the code:
   - the gap lives on `.bp6-popover-transition-container`, `1rem` for a rail
     icon and `5rem` for a full row (`.panelPopoverRail` / `.panelPopoverWide`,
     both on the portal class - the portal is outside the sidebar's DOM, so the
     component is the only thing that knows which state it opened from).
     Popper's `offset` is zeroed to `[0, 0]` so this margin is the whole gap
     rather than sitting on Blueprint's 15px of arrow space (`arrow/2`, for an
     arrow we hide);
   - **Blueprint's `.bp6-popover-content` has a background and no radius at
     all**, so the 12px on the wrapper never showed - the white surface behind
     the rounded card had square corners. Both elements take
     `global.$radius-card`.
8. **Wider, with room for a title** (D4, D10): 340px -> 440px, header padding
   10px 16px, rows 6px 16px, and the tab title **wraps** instead of ellipsizing -
   a title is the thing the preview exists to show, so clipping it was the
   wrong trade. The url stays on one line with the whole value in its `title`.
   The list scrolls (`max-height: 320px`) rather than clipping a row under the
   card's bottom edge.
9. **The row keeps no `title`** (D7, revised by what the screenshot showed): the
   browser's own tooltip arrives at about the same delay as the panel and lands
   underneath it, so the row had two labels at once. The full name is the
   panel header's job now, and it carries its own `title`.
10. **Every override of a reused rule is nested** (D6). My `.header` and
   `.favIcon` share their elements with TabCard's and FavIcon's classes, which
   are single classes - a coin flip on bundle order. Nesting them under `.panel`
   (or `.tabRow`) is a 0,2,0 specificity that wins in any order; the compiled
   css was checked for the nested form.
