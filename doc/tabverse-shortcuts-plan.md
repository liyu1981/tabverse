# Plan: Launchpad (account-level shortcuts)

Status: **built** (2026-11, revised after review). Extension and server.
Proposes a new account-level record entity (`shortcut`), so it touches
`adr/0001` (the record stream) and `adr/0002` (privacy posture); it
deliberately does not touch the per-tabverse tools or their aggregates.
Related: `doc/tabverse-hover-preview-plan.md` (a manager view that is not a
tabverse tool), `adr/0016` (a picture is a cache; nothing depends on one).

**Naming, decided:** the page and the sidebar entry are **Launchpad**; a row
is a **shortcut** (the record entity stays `shortcut`, the table
`SavedShortcut`, the data module `data/shortcut/`). A shortcut is a thing you
save; the Launchpad is where you launch it. UI copy uses "Launchpad" for the
page and "shortcut" only when talking about the item itself ("Add this tab to
Launchpad", "Already in Launchpad").

## 0. What is being asked

1. A **new manager view, after the search view** (`src/ui/manager/routes.ts`):
   an Apple-Launchpad-like page of tiles, so a person can open a saved shortcut
   in one click.
2. **Cross-tabverse**: unlike a Bookmark (which belongs to one tabverse and
   travels with it), a shortcut is saved once and available from every
   tabverse in every window - for the web tools a person uses all day.
3. **Synced to the server** like the rest of the account's records, so the
   Launchpad is the same on every paired browser. The review confirmed this is
   the existing account pairing, not a second sync mode.
4. **Four places to add one**: the tab list, the Bookmark tool, the History
   tool, and the toolbar popup ("add the current tab").
5. **Grab the site's logo and title as iOS/macOS do** - a large,
   home-screen-quality icon rather than the 16px favicon the rows use - and
   **store the icon bytes**, so a tile survives hotlink blocking, offline use
   and a site that later deletes its icon.
6. The Launchpad can **delete**, **filter**, and **switch between alphabetical
   and newest-first order** (the choice is remembered locally).

Explicitly not requested: keyboard shortcuts (`chrome.commands`), folders,
drag reorder, a launchpad on the new-tab page, or opening shortcuts from the
popup.

## 1. Where we are (grounded)

- **Routes are a closed enum.** `ManagerViewRoute` has `Opened`, `Saved`,
  `Search`, `Webtool` (`src/ui/manager/routes.ts`); `ManagerView` switches on
  it (`src/ui/manager/ManagerView.tsx`), and `Sidebar` draws one entry per
  route (`src/ui/manager/Sidebar/Sidebar.tsx`). Search is conditional on
  `useServerSyncConfigured()`; Webtool is debug-only.
- **The Bookmark pattern is the wrong shape for this.** A `Bookmark` carries
  `tabSpaceId` (`src/data/bookmark/Bookmark.ts`), is loaded per tabverse by
  `loadAllBookmarkByTabSpaceId` (`src/data/bookmark/util.ts`), is ordered by a
  per-tabverse aggregate (`SavedAllBookmark`), and is part of the tabverse's
  bundle, export and delete. A global flag on that row would mean every one of
  those places special-cases it.
- **Records are generic, entities are a closed set.** `EntityName` in
  `src/data/repo/types.ts` mirrors `api/openapi.yaml`; `dbBridge.ts` maps
  entity ↔ Dexie table; the change feed hooks *every* table
  (`src/data/repo/changeFeed.ts`), so a new table is queued without new code,
  but an entity not in `isEntityName` is dropped by the outbox
  (`outbox.ts:162`). The server has its own closed set in
  `server/internal/store/models.go` (`Entities`, `IndexedEntities`), and
  `ApplyRecords` rejects an unknown entity for the whole push
  (`server/internal/store/records.go`).
- **The popup writes records but never starts the change feed.**
  `src/ui/manager.tsx` awaits `startChangeFeed()` before its first write;
  `src/ui/popup.tsx` does not, although `importTabSpace` writes rows from
  there. Those writes never reach the outbox, so a popup-created record is
  local-only until something else rewrites it. (That is a pre-existing gap;
  this plan avoids it for shortcuts by going through the worker, D8.)
- **A manager page can learn about another context's write.** Dexie hooks call
  `notifyLocalTablesChanged` even during a remote apply
  (`changeFeed.ts:187`), but the cross-context runtime message is only sent for
  the tables in `NOTIFY_TABLES` (`src/data/repo/localTables.ts`), which today
  are the tabverse, tab and closed-tab tables.
- **Page reading already has a shape.** `src/data/tabSpace/tabText.ts` runs a
  self-contained function with `chrome.scripting.executeScript`, behind an
  injectable extractor, and fails soft on `chrome://`, PDFs and dead tabs. The
  manifest already carries `scripting`, `tabs` and `<all_urls>`; **no new
  permission is needed** for the logo capture or the icon fetch.
- **Image work already has a shape.** `src/data/tabSpace/tabPreviewImage.ts`
  decodes a capture, scales it on a canvas and re-encodes it, with the canvas
  as the injected seam so node tests see the "no canvas" branch. The new icon
  pipeline is the same idea, with one difference: it must also run in the
  service worker (the popup path, D8), so it uses `OffscreenCanvas` and
  `createImageBitmap`, which both exist in pages and workers in Chrome 140.
- **No browser in the tests** (AGENTS.md): the repo asserts pure functions and
  static markup (`renderToStaticMarkup`), and leaves hover/click/visual checks
  to the person.
- **19 locales** are checked for key parity (`tools/i18ncheck.mjs`); the
  non-English catalogs carry the English text until translated.

## 2. The shape of it

```
                      ┌──────────────────────────────────────────────┐
 sidebar              │  Launchpad        [A-Z|new] [filter ....]    │
 ───────              │  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐      │
 Live tabverse        │  │ ▣    │  │ ▣    │  │ ▣    │  │ ▣    │      │
 Other tabverses      │  │Figma │  │ GitHub│ │Linear│  │Notion│      │
 Saved tabverses      │  └──────┘  └──────┘  └──────┘  └──────┘      │
 Search               │     ...                                       │
 Launchpad   ← new    └──────────────────────────────────────────────┘
```

One record entity, one new table, one new view, four add buttons.

```
tab / bookmark / history ─┐
                          ├─► data/shortcut/addShortcut.ts ─► SavedShortcut (Dexie)
toolbar popup ────────────┘        │  (icon: page read, fetch, resize)   │
                                   │ change feed (hooks)                 │ pull (sync)
                                   ▼                                     ▼
                              outbox ──► POST /sync            applyServerRecords
                                                                         │
                         $shortcuts (effector) ◄──── loadShortcuts ──────┘
                                   │
                                   ▼
                          LaunchpadView
```

## 3. Decisions

| #   | Question | Decision | Why |
| --- | -------- | -------- | --- |
| D1 | One entity per shortcut, or a global flag on Bookmark? | **A new `shortcut` entity** with no `tabSpaceId`, no aggregate, and no tabverse relationship. | Being outside every per-tabverse rule is the feature: no bundle, no export, no cascade delete, no aggregate. A flag would make each of those rules remember to exclude it. |
| D2 | Ordering | **Two orders, remembered locally**: alphabetical (default) or newest-first, in a `useSettingItem` value (`tabverse_launchpad_order`, localStorage) exactly like the History tool's grouped switch. Not synced, not a record. | The review asked for both; a display preference belongs to the window, not to the account (two devices can want different ones). Alphabetical is the launchpad default; newest-first is what makes a just-added tile obvious. |
| D3 | Where the id comes from | Minted by `getNewId()` like every record; rows are keyed by `id`, `url` is indexed for the duplicate check. | A url is not an identity: two rows for one url on two devices is possible (D6), and the user deletes one. |
| D4 | What the record holds | `name`, `url`, `iconDataUrl`, `iconUrl`, `favIconUrl` (strings), plus `IBase`. No `tabSpaceId`. | `iconDataUrl` is the stored bytes (primary); `iconUrl` is the source (second choice, and what a future refresh would re-fetch); `favIconUrl` is the tab's own icon (last URL fallback). Same field naming style as Bookmark/ClosedTab. |
| D5 | Where the logo comes from, and how it is kept | An injected page read of `apple-touch-icon` / sized `<link rel=icon>`, then a **one-time fetch, decode and resize to a ≤48k-character PNG data URL** stored in the row. `iconUrl` and `favIconUrl` are the fallbacks, and an empty or broken icon draws a **local monogram** - never `dummyimage.com`. | The review chose bytes: a URL breaks when the site blocks hotlinking, deletes the icon, or is offline, and a launchpad that loses its logos is not a launchpad. Bytes are a few KB per row and make the tile self-contained on every device. |
| D6 | Add is idempotent? | **Within one profile, by normalized url**: adding a page already saved returns the existing row and changes nothing, except filling an empty `iconDataUrl`. The button stays **enabled** and shows a tick when saved; clicking it again toasts "Already in Launchpad" rather than doing nothing silently. Across devices duplicates are possible and are the person's to delete. | The review asked for the toast on a repeat add, and a disabled button cannot explain itself. Cross-device dedupe needs a merge policy (which name wins?) and tombstones for the loser, which is a feature of its own. |
| D7 | Which urls are allowed | `http:`/`https:` only; the add controls are absent for `chrome://`, `file://`, extension pages and the manager tab. | A shortcut to a local file or a browser-internal page does not survive a sync and cannot be opened from another tab. |
| D8 | The popup's add path | One runtime message, `BackgroundMsg.AddShortcutFromTab`, handled by the **service worker**, which reads the tab, grabs the icon and writes the row. | The popup dies on focus loss; a worker message survives it. The worker already has the change feed and the sync engine, and a later `chrome.commands` action would call the same handler. Calling `startChangeFeed()` in the popup would also work but leaves the icon capture tied to a window that may vanish. |
| D9 | Sync scope | **The existing account pairing** (confirmed in review). No new toggle, no new server, no separate "global settings" stream: `shortcut` joins the record entity set, so `listLocalRecords` / `countLocalRecords` / outbox / pull all include it by construction. | The review's "global like setup sync" is "an account-level record", which is exactly what the per-user record store already is. A second sync mode would be a second source of truth. |
| D10 | Server search | `shortcut` is accepted but **not added to `IndexedEntities`** in v1. | OmniSearch's result unit is a tabverse, and a shortcut has no tabverse, so indexing it would produce hits the client must drop. The Launchpad has its own filter. (The console's record browser can still filter shortcuts by substring.) |
| D11 | Export/import | Not in a `.tabverse` file, not in the console's tabverse bundle, not deleted with a tabverse. | It is not part of a tabverse. The tabverse export stays what it says it is. |
| D12 | Does this need a new permission? | No. `scripting`, `tabs` and `<all_urls>` are already declared; the icon fetch is an extension `fetch` to a host the extension already has, and the data URL is an `<img>`, which the CSP allows. | One less prompt for the person and one less store review concern. |
| D13 | Name | **Launchpad** for the view, sidebar entry, route (`ManagerViewRoute.Launchpad = 'launchpad'`) and docs; `shortcut` for the record entity, table and data module. | The review's answer to the naming question. A row is a shortcut; the page that shows them is the Launchpad. Keeping the data name stable is honest about what the row is and avoids a second rename if the page name changes again. |

## 4. Grabbing and storing the logo (the one browser-facing part)

Split into a page read (find candidate urls), a fetch-and-resize step (turn
the best one into bytes) and a pure picker, so every step is testable without
a browser. `src/data/shortcut/icon.ts` and `src/data/shortcut/iconBytes.ts`
get the same treatment as `tabText.ts` and `tabPreviewImage.ts`: injectable
seams and pure helpers.

### 4.1 The injected read

`collectIconLinks` (runs in the page) returns:

```
[{ href, rel, sizes: number[] }]   // from link[rel~="apple-touch-icon"],
                                   // link[rel~="apple-touch-icon-precomposed"],
                                   // link[rel~="icon"], link[rel="shortcut icon"]
```

- `sizes` is parsed from the attribute (`"32x32 64x64"`); no `sizes` means 32.
- `link[rel="mask-icon"]` is skipped (monochrome), and `og:image` is **not** a
  logo - it is a social card, and iOS does not use it.
- `link[rel="manifest"]` is not fetched in v1: a second request, a JSON
  document we would have to defend against, and `apple-touch-icon` already
  covers the quality the feature is about. (Later improvement, see §13.)

**The pure picker** (`pickBestIconUrl(links, pageUrl)`) ranks the page's own
links:

1. an `apple-touch-icon` (largest declared size first; 180 is the usual),
2. an `icon` with the largest declared size,
3. any `icon`.

It answers `''` when there is none, and the caller then tries the tab's own
`favIconUrl`, then the monogram - a page-level fact and a tab-level fact do
not belong in one ranking function.

Each href is resolved with `new URL(href, pageUrl).href` and kept only when it
is `http(s)` or a small `data:image/...`; anything else (a `javascript:`
payload from a hostile page, a `chrome://` icon) is dropped.

### 4.2 From url to stored bytes

`fetchIconAsDataUrl(iconUrl)` runs in the page **and** in the service worker:

1. `fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer',
   cache: 'force-cache', signal: <5s timeout> })`. Omitting credentials keeps
   the person's cookies out of a request that only wants a public logo; the
   host permission makes the cross-origin read legal.
2. Reject a non-2xx, a non-`image/*` content-type, or a body over 2 MB.
3. Raster: `createImageBitmap(blob)`, draw it "contain" onto an
   `OffscreenCanvas` at `iconTargetSize(w, h)` (128 px on the long edge, clear
   background so alpha survives), `convertToBlob({ type: 'image/png' })`, then
   base64 the bytes with a chunked `bytesToBase64` helper.
4. If the 128px PNG is over `MAX_ICON_DATA_URL_CHARS` (48k characters, roughly
   36 KB), retry once at 64 px. Still over, or any step throws, or the browser
   cannot decode it (an `.ico` `createImageBitmap` refuses, an SVG rasteriser
   that is not there): keep the source bytes when they are already a small
   `image/png|jpeg|webp|gif|x-icon` and fit the cap; otherwise `''`.
5. SVG is special-cased before decoding: an `image/svg+xml` body under 16 KB
   is stored as `data:image/svg+xml;charset=utf-8,` + `encodeURIComponent`,
   which `<img>` renders and which cannot run script.
6. Never throws: every failure is `''`, and the caller falls back to
   `iconUrl`, then `favIconUrl`, then the monogram.

The constants (`128`, `48_000`, `2 MB`, `5s`) are exported and pinned by
tests. A compressed PNG of a 128px logo is normally 5-15 KB; the cap is what
keeps a row and a sync payload small.

### 4.3 Which page is read

If the add came from a live tab, that tab. From a Bookmark or History row, the
name and url are the row's, and the icon comes from the live tab with the same
normalized url if one is open anywhere (`chrome.tabs.query({})`, linear match
- only on a click); otherwise the row's own `favIconUrl` is fetched. A
suspended/discarded tab, a `chrome://` page or a tab that navigated away fails
the injection and falls back the same way.

### 4.4 What is stored, drawn and sent

The row keeps `iconDataUrl` (the bytes), `iconUrl` (the source, kept for the
fallback chain and a possible future refresh) and `favIconUrl`. Drawing is a
small `ShortcutIcon` that tries `iconDataUrl`, then `iconUrl`, then
`favIconUrl`, then the monogram (the first letter of the name on a background
colour derived from the host's hash out of a fixed palette), so a deleted
icon, a site that blocks hotlinking and a failed fetch all still look
intentional.

**Privacy:** the add fetches a public image once and stores it locally and in
the synced record; after that the Launchpad makes **no remote request** to
draw a tile, which is better than a url-only design on a second device or an
offline one. The bytes are a site's own icon, not a picture of the person's
screen (unlike `adr/0016`'s thumbnails), so they are allowed to travel; they
are base64 text inside the JSON payload like any other record field. No
third-party host is contacted (which is what `FavIcon`'s `dummyimage.com`
fallback still does today, and a new component should not copy it).

## 5. The view

`LaunchpadView` is the container (store, delete, order, toasts) and
`LaunchpadGrid` is presentational, so its markup is testable without a browser
(the split `HistoryView` and `TabverseHoverPreview` use).

- **Header:** "Launchpad", the count, the order switch, and the shared
  `ListFilter` box (`data/search/inMemorySearch.filterByText` over
  `name + url`); no paging - the grid scrolls. Same filter semantics as
  Bookmark/History, so the boxes agree about what matches.
- **Order switch:** two minimal buttons in a `ButtonGroup`
  (`sort-alphabetical`, `sort-desc`), `aria-pressed`, tooltips "Name" /
  "Newest", read and written with `useSettingItem<string>(
  'tabverse_launchpad_order', ...)`. Default alphabetical; an unknown stored
  value falls back to it. Window-local, like the History grouped switch.
- **Grid:** `<ul>` of `<li>` tiles, `grid-template-columns:
  repeat(auto-fill, minmax(104px, 1fr))`, 24px gap, aligned to the top.
- **Tile:** a link (`<a href={url} target="_blank" rel="noreferrer">`) so
  click, middle-click and Ctrl-click all open the page in a new tab with
  Chrome's own behavior, the 64px rounded icon, and the name clamped to two
  lines with the full name in `title`. The link's accessible name is the
  name; the icon is `alt=""`.
- **Delete:** a small trash button as a **sibling** of the link (a button
  inside an anchor is nested interactive content), quiet until the tile is
  hovered or `:focus-within`, `aria-label` naming the shortcut. No confirm and
  no undo in v1 - it is one row, and the add paths are one click away.
- **Empty state:** "Your Launchpad is empty", plus where shortcuts come from
  (a tab's button, a bookmark, a closed tab, the toolbar popup). **No
  matches** state for a filter that finds none.
- **Theme:** the same card radius and colours as the rest of the manager; the
  icon gets a white/neutral backing so transparent PNGs read on dark too.

Sorting is a pure function (`orderShortcuts(shortcuts, mode)`) so the two
orders and their tiebreak (`localeCompare` on the name, then url; newest
first on `createdAt`, then name) are tested without rendering.

## 6. The four add paths

One core (`data/shortcut/addShortcut.ts`), four callers:

| Where | Control | Source of name/url/icon |
| ----- | ------- | ----------------------- |
| tab list | a `tile-plus` button beside the bookmark button (`TabCard`, guarded by `chromeTabId > 0` and an http(s) url, like the bookmark button) | the live tab + injection + fetch |
| Bookmark tool | a `tile-plus` button on each row (`BookmarkView`) | name/url from the bookmark row, icon from the live tab if one is open |
| History tool | a `tile-plus` button on each row (`HistoryView`), next to "save as bookmark" | name/url from the closed tab, icon from the live tab if one is open |
| toolbar popup | a header icon button (`PopupView`) | the active tab of the popup's window, via the worker message (D8) |

Each shows a toast: `Added to Launchpad`, `Already in Launchpad`, or `Could
not read this tab`. The buttons stay enabled; the saved state is a `tick`
icon, so a repeat click can explain itself (D6). Adding from History does
**not** remove the row - unlike "save as bookmark", a shortcut is not a copy
of the history entry and deleting it would be a surprise. Saved-tabverse cards
keep no shortcut button in v1: their tabs are not live and the row already has
a "open in a new window" action.

## 7. Sync and the server

Extension:

- `EntityName` gains `'shortcut'` (`src/data/repo/types.ts`), which also adds it
  to `isEntityName` - without that the outbox silently drops the entries.
- `dbBridge.ts` gains `{ entity: 'shortcut', table: 'SavedShortcut' }`;
  `listLocalRecords`, `countLocalRecords` and `applyServerRecords` then include
  it with no further change.
- `changeFeed` hooks the new table automatically; `localTables.NOTIFY_TABLES`
  gains `SavedShortcut` so an open Launchpad (or the add buttons' saved state)
  re-reads when the worker applies a pulled record.
- `startChangeFeed()` stays where it is for pages; the popup path goes through
  the worker (D8), so no popup bootstrap change is needed. The worker's
  `AddShortcutFromTab` handler still awaits it (it is idempotent): a message
  can arrive before the worker's own async boot has installed the hooks.
- **Payload size:** a shortcut with a 128px icon is roughly 8-20 KB of base64
  (capped at 48k characters). A hundred shortcuts is a couple of megabytes on
  the first upload and on a fresh device's first pull - acceptable, and the
  reason the cap exists. The server's 1 MB per-record limit is not in play.

Server:

- `Entities` in `server/internal/store/models.go` gains `shortcut`;
  `IndexedEntities` deliberately does not (D10).
- `displayTitle` gains `case "shortcut": title, url = str("name"), str("url")`
  so the console shows a name rather than `shortcut <id>`.
- `nonContentKeys` (`records.go`) gains **`iconDataUrl`** (and `iconUrl`) so a
  base64 image never reaches FTS or a console snippet. `favIconUrl` is already
  indexed today; leaving it is fine, but the icon data is not.
- **Not** in `tabspaceEntities` (`admin.go`): a tabverse delete must not touch
  an account-level row, and the `tabSpaceId` extract is NULL for it, so the
  bundle and cascade already leave it alone - a test pins that.
- `api/openapi.yaml` adds `shortcut` to the `Entity` enum.

Compatibility, stated plainly:

- **New extension + old server:** `ApplyRecords` rejects the unknown entity
  and the whole push fails. The outbox keeps the entries and replays after the
  server is upgraded, but other records wait with them. The release notes must
  say **upgrade `tabversed` first**, and the sync error path should say
  "this server is older than this extension" when the error is
  `unknown entity` rather than a generic failure.
- **Old extension + new server:** the old client has no table for the entity,
  `applyServerRecords` counts it as an error and skips it; it never sends one.
  Shortcuts are simply invisible on that device, and nothing else breaks.

## 8. Work items, in order

1. **The record.** `Shortcut.ts` (`shortcutFromPage`, `normalizeShortcutUrl`,
   `shortcutNameOf`, `newEmptyShortcut`), `SHORTCUT_DB_TABLE_NAME`/`SCHEMA`,
   `storage/schema.ts`, `TABSPACE_DB_VERSION` 11 → 12 and its upgrade note in
   `global.ts`, plus an upgrade test that a v11 database opens with the new
   empty table and every old row.
2. **The store and the writes.** `store.ts` (`$shortcuts`, pure
   `upsertShortcut`/`removeShortcut`/`orderShortcuts`), `util.ts`
   (`loadShortcuts`, `saveShortcut`, `deleteShortcut`, `findShortcutByUrl`,
   `startMonitorShortcutChanges`), and `loadShortcuts` in
   `tabSpaceBootstrap` so the tab/bookmark/history buttons can show saved state.
3. **Sync plumbing.** `EntityName`, `dbBridge`, `NOTIFY_TABLES`, plus the
   repo tests: a create queues one outbox entry, a delete queues a tombstone,
   the entity maps both ways, and a pulled shortcut lands in the table.
4. **The logo.** `icon.ts` (the injected collector and the pure picker),
   `iconBytes.ts` (fetch, decode, resize, base64, caps), the injected seam, and
   `addShortcut.ts` with its injectable deps.
5. **The launchpad.** `LaunchpadView` + `LaunchpadGrid` + styles; the route,
   the `ManagerView` case and the sidebar entry after Search (always shown - it
   is local-first, unlike Search); the order switch.
6. **The four add buttons.** `TabCard`/`TabSpaceListView` (props like
   `isBookmarked`/`onBookmark`), `BookmarkView`, `HistoryView`, the popup +
   worker message, and the three toasts.
7. **Server.** The allowlist, `displayTitle`, `nonContentKeys`, the openapi
   enum, and the Go tests (including "a tabverse delete leaves shortcuts
   alone").
8. **Copy and docs.** The message keys in all 19 locales (English body for the
   rest, as usual), `pnpm run i18n:check`; `ARCHITECTURE.md`'s entity list and
   a "Launchpad" section; a
   `doc/tabverse-website/docs/basic-usage/launchpad.md` page and an
   `doc/tabverse-website/static/llms.txt` line, then `pnpm run build-doc` so
   the committed `docs/` tree matches.
9. **The decision record.** `adr/0035-shortcuts-are-account-level.md`, drafted
   from §14.

## 9. Files

| Path | What |
| ---- | ---- |
| `src/data/shortcut/Shortcut.ts` | type, table name/schema, url normalization, page → record |
| `src/data/shortcut/store.ts` | `$shortcuts`, list operations, `orderShortcuts` |
| `src/data/shortcut/util.ts` | load/save/delete/find-by-url, the DB-change monitor |
| `src/data/shortcut/icon.ts` | injected icon collector, pure picker, monogram/colour |
| `src/data/shortcut/iconBytes.ts` | fetch, decode, resize, encode, caps (page + worker) |
| `src/data/shortcut/addShortcut.ts` | the one add path (tab, row, live-tab reuse) |
| `src/ui/launchpad/LaunchpadView.tsx` | container: store, delete, order, toasts |
| `src/ui/launchpad/LaunchpadGrid.tsx` | presentational grid + tile + icon |
| `src/ui/launchpad/*.module.scss` | launchpad and tile styles |
| `src/ui/manager/routes.ts`, `ManagerView.tsx`, `Sidebar/Sidebar.tsx` | the route and its entry |
| `src/ui/manager/TabSpace/TabCard.tsx`, `TabSpaceListView.tsx` | the tab-row button |
| `src/ui/bookmark/BookmarkView.tsx`, `src/ui/history/HistoryView.tsx` | the row buttons |
| `src/ui/popup/PopupView.tsx`, `src/message/message.ts`, `src/background.ts` | the popup → worker add |
| `src/data/repo/types.ts`, `dbBridge.ts`, `localTables.ts` | entity, binding, notification |
| `src/storage/schema.ts`, `src/global.ts` | v12 and the new table |
| `public/_locales/*/messages.json` | the strings |
| `server/internal/store/models.go`, `admin.go`, `records.go` | allowlist, console title, FTS noise |
| `api/openapi.yaml` | the entity enum |
| `ARCHITECTURE.md`, `adr/0035-*.md` | architecture and the decision |
| `doc/tabverse-website/docs/basic-usage/launchpad.md`, `doc/tabverse-website/static/llms.txt`, rebuilt `docs/` | the website page |

## 10. Gotchas

- **`isEntityName` is a gate, not a type.** Adding the entity to the union but
  not to `ENTITY_NAMES` loses every queued write; the test in step 3 is what
  catches it.
- **`NOTIFY_TABLES` is a second gate.** Without `SavedShortcut` there, a
  shortcut pulled on another device appears only after a reload, and the add
  buttons' saved state stays stale.
- **The popup has no change feed.** That is why its add goes through the
  worker (D8); do not "just write the row" there. The same missing call is
  why a tabverse imported from the popup is not queued for sync today - a
  pre-existing gap this feature does not try to fix.
- **`SavedShortcut` is not a tabverse child.** Never add it to
  `tabspaceEntities`, `tabverseEntries`, the export payload or the import
  transaction; a test should assert the console bundle and the cascade delete
  leave it alone.
- **The base64 is data, not text.** `iconDataUrl` must never reach FTS, a
  snippet, a log line or the tab filter's page-text path; `nonContentKeys`
  plus a test is what keeps the record from becoming a 48k "word".
- **The tab row's guards.** `chromeTabId > 0` (a saved tab carries `-1`, and
  `-1` is truthy) and an `http(s)` url (the manager tab itself is on the
  screen); the bookmark button already had to learn the first one.
- **Icon extraction is optional.** A PDF viewer, a `chrome://` page, a
  discarded tab, a site that blocks hotlinking and a site whose icon will not
  decode must all reach the monogram, not an error path.
- **No third-party placeholder.** `FavIcon`'s `dummyimage.com` fallback is
  pre-existing; the new tile must not copy it.
- **A hostile payload can reach a second device.** `iconDataUrl`/`iconUrl`/
  `favIconUrl` are strings from a record; the renderer must re-check the
  scheme and the size, not trust the writer's check, and only `data:image/`
  and `http(s)` are acceptable.
- **Old server, new extension** is the one hard compatibility edge (§7).

## 11. Tests

| Suite | What it pins |
| ----- | ------------ |
| `data/shortcut/__tests__/shortcut.test.ts` | url normalization (hash, root slash, non-http rejected), name fallback to host, page/row → record |
| `data/shortcut/__tests__/icon.test.ts` | apple-touch over sized icon, largest size wins, relative hrefs resolved, `javascript:`/`chrome://` rejected, monogram and colour are pure |
| `data/shortcut/__tests__/iconBytes.test.ts` | node-safe pure maths: `iconTargetSize` contain rule, chunked `bytesToBase64`, the 128 → 64 retry, the 48k cap and the 2 MB/5s refusals, SVG passthrough, every failure returns `''` (a fake fetch/decode seam) |
| `data/shortcut/__tests__/store.test.ts` | add is idempotent by url, an empty icon is filled, delete removes one, `orderShortcuts` for both modes and their tiebreaks |
| `data/repo/__tests__/shortcutSync.test.ts` | entity ↔ table both ways, create queues one entry, delete queues a tombstone, a pulled record (data URL included) populates the table (fake-indexeddb + `MemoryStorageArea`) |
| `ui/launchpad/__tests__/LaunchpadGrid.test.tsx` | static markup: a link per tile with the right `href`/`target`, the name, a labelled delete button, empty and no-match states, the filter count, the icon source order (`iconDataUrl` before `iconUrl`) |
| `ui/manager/__tests__/...` | `ManagerViewRoute.Launchpad`, the sidebar entry after Search, and no shortcut button appears without a live http(s) tab |
| Go `store`/`api` tests | `shortcut` is a valid entity, accepted/pulled, absent from `IndexedEntities` and `tabspaceEntities`, `DeleteTabspace` leaves it, `displayTitle` names it |
| i18n | key parity, and every key `t()` accepts exists |

## 12. Verification

- `pnpm run typecheck`, `pnpm exec vitest run`, `pnpm run format:check`,
  `pnpm run lint:check`, `pnpm run i18n:check`, `pnpm run build`.
- `cd server && go vet ./... && go test -race ./...`.
- No browser is driven (AGENTS.md). What to look at by hand:
  1. **Launchpad** appears after Search (and still appears without a server).
  2. Add from a tab, a bookmark and a closed tab: each tile lands with a large
     logo and the page's title; clicking add again says "Already in
     Launchpad".
  3. Add from the toolbar popup on a normal page, then close the popup at
     once; the tile is still there.
  4. Filter by name and by url; switch the order and reload - the choice is
     remembered; delete a tile.
  5. Pair a second browser: the tiles arrive **with their icons** (no network
     fetch on draw), and deleting on one removes it on the other.
  6. A `chrome://` page, a PDF and a site that blocks hotlinking: the button
     is absent or the tile shows bytes/monogram rather than a broken image.
- The implementation report should say plainly what was not verified (the
  visuals and the hover/click paths).

## 13. Not in this increment

- Manual "add by url" (a Launchpad with no way to add a site you have never
  opened), editing the name in the grid, drag reorder, folders/tags.
- Undo for delete.
- `manifest` icons and `og:image`; icon refresh for an existing shortcut (the
  `iconUrl` is kept so a later refresh can re-fetch it).
- Opening shortcuts from the popup, or a new-tab Launchpad.
- Keyboard shortcuts and keyboard commands.
- Shortcuts in OmniSearch (D10) and in `.tabverse` export/import (D11).
- Cross-device dedupe/merge (D6), and de-duplicating icon bytes between two
  shortcuts to the same site (each row owns its copy; the cap keeps that
  honest).

## 14. Decisions from the review (and one left open)

Answered and folded in above:

1. "Global sync" is the **existing account pairing** (D9).
2. The order **switches between alphabetical and newest-first**, remembered
   locally (D2).
3. Adding from History does **not** delete the row, and a repeat add **toasts
   "Already in Launchpad"** (D6, §6).
4. The logo is stored as **bytes**, not a url (D5, §4).
5. The user-facing name is **Launchpad** (D13).

The icon budget as built: a 128px PNG, retried at 64px, capped at 48k
characters of data URL, and never upscaling a source smaller than the target.
A tighter cap (64px only) would halve the payload but visibly soften a retina
tile; the constants are exported so that is a one-line change if real uploads
look heavy.

## 15. Proposed decision record (to become `adr/0035`)

**Shortcuts are account-level records, and a logo is bytes.**

1. A `shortcut` is an account record with no tabverse: no `tabSpaceId`, no
   per-tabverse aggregate, not in a tabverse's bundle, export or delete. Its
   whole point is to be outside those rules rather than a "global" exception
   inside them.
2. It syncs on the existing pairing as one more entity; there is no second
   sync mode. The account's record stream is the only source of truth.
3. The logo is captured best-effort from the page (`apple-touch-icon`, then a
   sized `<link rel=icon>`), fetched once, resized to a 128px PNG and stored
   as a `data:image/...` string in the record. The bytes travel with the
   record so a tile is self-contained on another device and offline; a missing
   or broken icon is a locally drawn monogram, and no third-party placeholder
   is contacted. The source url is kept beside it for the fallback chain and a
   future refresh.
4. Adding is idempotent by normalized url within a profile; a repeat add keeps
   the existing row and says so. Duplicate rows across devices are allowed in
   v1 and are the person's to delete.
5. The page is called the Launchpad; the row is a shortcut. It is a manager
   route that works with no server; sync is optional like everywhere else.

## 16. Where the build differed from the plan

- **The icon bytes are produced in the page and in the service worker by one
  implementation** (`OffscreenCanvas` + `createImageBitmap`), as planned; the
  popup path therefore needed no page context. the fetch path gained two guards the
  plan did not spell out: a `content-length` refusal before the body is read,
  and inline `data:` icons stored once (`iconUrl` is cleared when the source is
  already the bytes, so a row never carries the same picture twice).
- **The entity and the table kept the `shortcut` name** while the UI is
  "Launchpad" (D13), including the route value `launchpad`.
- **The order switch** is two `aria-pressed` buttons (`sort-alphabetical`,
  `sort-desc`) rather than a picker, and the stored value is the string
  `alphabetical` / `newest`.
- **The popup's worker answer carries only `{ok, status, name}`**, never the
  record: the icon can be tens of kilobytes and the popup only needs to say
  what happened. The add still writes the full row in the worker.
- **The tab/bookmark/history buttons show a tick but stay enabled**, and a
  non-http(s) row renders no shortcut button at all (the add path would answer
  `invalid`).
- **The Launchpad re-checks every icon url and the link href at draw time**
  (`safeIconUrl`, `normalizeShortcutUrl`), because a synced payload is not a
  trusted writer; a hostile row draws a monogram and no link.
- **The website manual has a Launchpad page** and `llms.txt` lists it, and the
  committed `docs/` tree was rebuilt (`pnpm run build-doc`).

Verification as built: `pnpm run typecheck`, `pnpm exec vitest run` (160 files,
1234 tests), `pnpm run i18n:check`, `pnpm run format:check`, `pnpm run
lint:check`, `pnpm run build`, and in `server/` `go vet ./...` and `go test
-race ./...`. No browser was driven (AGENTS.md); the tile visuals, the hover
delete button and the four add buttons are for the person to look at.
