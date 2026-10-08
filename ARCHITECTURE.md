# Tabverse architecture (after the server pivot)

```
┌─ Chrome extension (MV3) ────────────────┐      ┌─ tabversed (Go) ──────────────┐
│ popup / manager pages (React)           │      │ cmd/tabversed                 │
│  ├─ ui/                                 │ REST │  internal/api    HTTP routes   │
│  ├─ data/  domain stores (effector)     │◄────►│  internal/sync   delta + LWW   │
│  └─ data/repo/  ★ sync layer            │      │  internal/hub    WebSocket     │
│ background service worker               │  WS  │  internal/store  SQLite+FTS5   │
│  ├─ background.ts  (tab events, sync)   │◄────►│  internal/auth   pairing       │
│  └─ repo/backgroundSync (sync runtime)  │      │  internal/retention (legacy)   │
                                                 │  internal/webui   console (UI) │
└─────────────────────────────────────────┘      └────────────────────────────────┘
```

## Repository layout

| Path                 | What                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/`               | the extension (unchanged entry points: `background.ts`, `ui/popup.tsx`, `ui/manager.tsx`)                |
| `src/data/repo/`     | **new** sync layer: types, HTTP client, outbox, delta engine, realtime client, Dexie bridge, change feed |
| `server/`            | the `tabversed` sync server (pure Go, no cgo)                                                            |
| `server/ui/`         | the console: a Vite/React app, built into `server/internal/webui/dist` and embedded in the binary (`adr/0018`)  |
| `api/openapi.yaml`   | wire contract for the server                                                                             |
| `adr/`               | architecture decision records                                                                            |
| `dist/manifest.json` | manifest (single source of truth today; generated later)                                                 |

## The sync layer (`src/data/repo/`)

Dependency direction is strictly downwards; nothing above `dbBridge` imports
Dexie, and nothing below imports `chrome`, so the whole layer is unit tested
without a browser:

| Module              | Responsibility                                                                                       | Test                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `types.ts`          | wire types mirrored from `api/openapi.yaml`                                                          | –                                                |
| `serverApi.ts`      | typed fetch client, error normalization (401 = re-pair)                                              | `serverApi.test.ts`                              |
| `outbox.ts`         | durable mutation queue in `chrome.storage.local`, collapses per record to newest edit                | `outbox.test.ts`                                 |
| `repo.ts`           | `SyncEngine`: flush outbox → pull delta → persist cursor; LWW conflict hooks; `ChromeSyncStateStore` | `repo.test.ts`                                   |
| `realtime.ts`       | WebSocket with injectable scheduler/backoff                                                          | `realtime.test.ts`                               |
| `dbBridge.ts`       | entity ↔ Dexie table mapping, `listLocalRecords` / `applyServerRecords`                              | `dbBridge.test.ts`                               |
| `changeFeed.ts`     | Dexie write hooks → outbox (creates, updates, deletes); suppresses pull→push echo                    | `changeFeed.test.ts`, `changeFeed.hooks.test.ts` |
| `localTables.ts`    | "these tables changed" notice for the UI: PubSub locally + a runtime message to the other pages      | –                                                |
| `syncConfig.ts`     | pairing + config persistence                                                                         | `syncConfig.test.ts`                             |
| `backgroundSync.ts` | wires all of the above for the service worker                                                        | `backgroundSync.test.ts`                         |

### Data flow

```
local edit  ──Dexie write hook──► outbox ──flush──► POST /sync (LWW push)
server copy ──delta pull──► applyServerRecords ──► Dexie (guarded by runAsRemoteApply)
remote edit ──WebSocket records_changed──► debounced syncOnce()
```

### Entities

`tabspace`, `tab`, `note`, `todo`, `bookmark`, `closedtab` (the History
tool: one row per closed tab, capped at 999 per tabverse, `adr/0007`) plus the
three per-tabspace ordered aggregates `allnote`, `alltodo`, `allbookmark`
(they carry the display ordering, which cannot be rebuilt from entity rows).

A tab record carries two layout facts. `tabGroups` is a hint on the tabverse
payload, and `TabCore.splitWith` names the other half of a split view by its tab
id (`adr/0022`): the layout is part of the tabverse, so it is saved and synced
and both the saved view and the console draw it. Chrome's own `splitViewId` is
deliberately not one of them — it is session scoped, so it is read from a live
window and never believed as a record, because two devices on one account each
have a "split view 7".

## Search (`src/data/search/`)

There is no client side index. A search is an OR of AND-groups, each with a
`{type, field}` scope, and it is answered by one of two backends
(`adr/0008`):

```
query ─┬─ paired device ─► GET /api/v1/search  ─► tabverse ids (bm25 ranked)
       └─ otherwise  ───► localSearch.ts       ─► tabverse ids (table scan)
                                                     │
                          loadTabSpacesByIds ◄──────┘  (drops ids this device
                          drops what is not local, and reports the rest)
```

`serverSearch.ts` turns a group into a request (its `type` scope becomes the
server's `entity=` filter) and resolves the `tabspace_id` the server returns;
`localSearch.ts` scans the tables behind the scope with a substring test. Both
return the same thing - ranked tabverse ids - so browsing and searching page
alike, and a server that is unreachable falls back to the local scan instead of
failing the search box.

## The live tab filter (`src/data/tabSpace/activeTabFilter.ts`)

The tabverse page's box over the tabs of the window on screen is not that
search, and deliberately does not share its machinery: there is nothing to look
up (the rows are the list being drawn), no scope to pick, and no reason to wait
for a server. It is a substring test over the window's own tabs, with the
`valueMatchesTerms` semantics of `data/search/searchable.ts` - a filter box is
expected to match inside a word - plus one scoring rule so the best match comes
first: a term in the title outranks the same term in the url, the whole phrase
next to itself in a title outranks the same words scattered, and ties keep the
window's tab order so the list never shuffles under the cursor.

Two consequences worth writing down:

- **While it filters, the list is flat and ranked.** Group headers and split
  blocks exist to show the shape of the window, and a best-match-first answer
  to "which one is it" has no shape. `tabverseTabs` (in `tabEntries.ts`)
  flattens `tabverseEntries` into the order the user sees, which is also the
  tie-break order.
- **It is the live tabverse only.** Nothing here is stored, synced or searched
  server side: a tab is already on screen, and it is the user's own eyes that
  asked the question.

## The history's box and its site groups (`src/data/closedTab/historyFilter.ts`)

The History card's two controls ask about the closed tabs of one tabverse, and
the answers are pure functions of the rows the store already holds: a substring
test over the title and the url, and a bucket per site - the url's host, lower
cased, without a leading `www.`, so `www.github.com` and `github.com` are one
group (`historySiteOf`). The host, not the registrable domain: collapsing
`mail.google.com` into `google.com` needs a public suffix list, and Chrome's own
history does not do it either. A page the browser serves itself is named by its
scheme instead (`chrome://extensions` under `chrome:` - its "host" is a page name,
not a site), and a row that is not a url at all goes to `(no site)` rather than
out of the list.

Like the live tab filter, it is a filter over the rows on screen and not the
search of `data/search`. Four things are worth writing down because they are
choices, not consequences:

- **It does not rank.** The live tab filter puts the best match first; the
  history does not. Its list is a timeline, so a page closed an hour ago stays
  above one closed last Tuesday however well the titles match - and each site's
  rows are drawn newest first for that same reason.
- **Groups follow the list.** A site appears in the order its newest page
  appeared, so the site you were reading most recently is the first header. Grouping
  never reorders: it only decides which rows sit under which header.
- **A term may come from the title and another from the url.** This is looser
  than `localSearch`, which needs every term inside one field, and deliberately
  so: there the answer is a whole tabverse and the scope says which field; here
  the rows are on screen, and "github issues" is one closed tab.
- **The grouped view does not page.** The pager pages rows, and a page that
  ended in the middle of a site's rows would print that site's header twice. So
  the flat list pages at ten (`usePageControl`) and the grouped one draws every
  entry under its site - which is what the search box is for. A tabverse keeps up
  to 999 entries (`adr/0007`), so the grouped view is the one to search rather
  than scroll.

Both the box and the switch are one component (`ui/history/HistoryToolbar`),
used by the extension's card and by the console's read-only panel alike - the
console already reuses this card's stylesheet and `usePageControl`, and a filter
drawn twice is a second one that will drift. The switch is a window-local
setting (`storage/localSetting`), not a record: nothing about how a list is
drawn is worth syncing to another device.

## The tabverses open in this browser (`src/data/tabSpace/openWindowStore.ts`)

The sidebar's "Other Tabverses" list, and the rule that keeps a tabverse open in
one window only. Both answer a question about *this* browser, and both answer it
the same cheap way: `chrome.tabs.query({})`, once.

A Tabverse tab carries its tabverse id in its url as `tvid` (`tabverseUrl`), so
the query says which tabverses are open, in which windows, and on which tab -
with no registry and no state to keep consistent. ADR 0006 removed this list
because it needed the old cross-window registry; the popup re-added it first
(`doc/tabverse-popup-plan.md` D8) and this is the same observation applied to the
sidebar. Names and tab counts are joined from IndexedDB on those ids, never the
other way round: `loadTabSpacesByIds` drops ids it cannot find, and a list that
empties itself because a neighbour's row is a moment late is worse than one row
with no name. Hovering one of those rows for a second shows what that tabverse has open -
the first four of its tabs in tab strip order, from `chrome.tabs.query` on that
window rather than from its saved rows, because a preview is a claim about the
window *now* and only the live query carries the strip order and the tab ids
(`data/tabSpace/tabversePreview.ts`). The panel is read-only: a row in a window
that is not on screen is not a place to press buttons on.

Each other window is a sidebar *entry*, which is what makes the
collapsed rail work for free: expanded it is a row with the tabverse's name
(truncated, full name in the title), collapsed it is a `th-derived` icon whose
tooltip is that name. Scope is one Chrome profile - another profile is another
extension install, and its tabs are not visible here.

**A tabverse is never opened twice.** `openOrSwitchToTabSpace` switches to the
window that has it and only creates a window when nothing does; `SavedTabSpaceView`
and the popup both reach the tabverse through it. This is not tidiness. Two pages
holding one id both autosave the row keyed by that id, so they overwrite each
other's `tabIds` and the tabverse's tab list flip-flops between the two windows.
The `CountExit` guard does not help - it only catches two manager pages in the
*same* window.

## Pairing: two ways in (`adr/0020`)

There are two, and both end at the same `SyncConfig` in `chrome.storage.local`:

```
custom     invite code   POST /api/v1/auth/pair        → config(kind: custom)
wizard     sign in       POST /api/v1/console/pair     → config(kind: official)
           (console session)   → page → chrome.runtime.sendMessage → extension
```

**The custom path** is unchanged and is how a self-hosted `tabversed` is paired:
an account mints a code, the extension redeems it. It needs no sign-in anywhere
the extension can reach.

**The wizard** exists because an extension cannot sign in to a site - the session
is a cookie in the browser's jar for that origin - so the *console page* does the
signing in and carries the token back:

1. The extension opens `https://tabversed.liyu1981.xyz/console?pair=1&ext=<its
   own id>&nonce=<uuid>` (the console's own page, and a plain HTTP URL since
   `adr/0023` - it used to be a fragment at `/`, which is what kept the nonce
   out of a log; see that ADR for why the trade flipped), and remembers the
   nonce in `chrome.storage.session`.
2. The person signs in and approves a device name; the page calls
   `POST /api/v1/console/pair`, which mints a device and a token for **the
   session's account** (`writeDevice`, the same function `auth/pair` uses) and
   refuses an impersonating session.
3. The page sends `{credentials, nonce}` to the extension over
   `chrome.runtime.sendMessage`, allowed to exactly one origin by the manifest's
   `externally_connectable` entry.
4. `onMessageExternal` - in the worker, which is what Chrome wakes for it, and in
   the dialog that opened the window, which is open by construction - checks
   message type, sender origin, the nonce (spent on read) and the credentials,
   then saves the config as `kind: 'official'` and tells the open pages.

`kind` is display only: both kinds sync identically, and **absent means custom**,
so every config written before the wizard existed is read correctly without a
migration. The sync dialog is two tabs because of it - *Status* (what sync is:
host, device, account, last sync, sync now / upload / disconnect) and *Setup* (a
switch between the two ways in).

The invite code is not a step the wizard drops; it is the reason a self-hosted
server needs no account it did not create, no redirect, and no message channel.

## Restoring a tabverse into a window (`src/data/tabSpace/restorePlan.ts`)

Loading a saved tabverse into the window its manager page is in used to be
"close every tab in the window, then open every tab of the tabverse". That is
right about the result and wasteful about the way there: a tab the user already
has open in that window was closed and opened again, losing its place in the
strip, its history and whatever state the page was holding.

So the restore asks the window first, and the answer is a plan
(`planRestore`): a saved tab whose url is already open in the window reuses that
tab, a saved tab with no open tab to stand for it is opened, and a window tab
that is in neither is closed. The plan is a pure function of the saved tabs and
the window's tabs, which is where the testable part of this lives; the chrome
calls are `util.ts`'s.

Three things it has to get right, and did not before:

- **One open tab stands for one saved tab.** A tabverse holding `chrome://newtab/`
  twice reuses two open tabs, not one, and an extra open copy of a url the
  tabverse has once is closed. Matching is on the url as a person reads it: the
  fragment and a trailing slash are dropped and the origin is lowercased, but the
  path is not (a query string or a capital in the path is a different page).
- **The strip is put back into the saved order.** Reused tabs sit where they were
  and opened ones land at the end, so without `orderWindowTabs` the tab strip and
  the tabverse list would disagree - which is the one thing the list is for. The
  order asked for is the tabverse tab, then the saved pinned tabs, then the rest,
  because Chrome's pinned section is at the front either way.
- **Live fields are written back into the store.** A reused tab raises no
  `tabs.onCreated`, so nothing would fill in the `chromeTabId` the list's close
  and switch buttons act on. The restore sets them from what the browser has.

The tabverse's own manager tab is never a reuse candidate and never closed: it
is the page doing the restoring.

## Commands

```sh
pnpm install            # install (pnpm-lock.yaml is the source of truth)
pnpm run develop        # vite build --watch (development, includes dev pages)
pnpm run build          # production bundle in dist/
pnpm test               # vitest + coverage
pnpm run typecheck      # tsc --noEmit
pnpm run lint:check     # biome lint
pnpm run format:check   # biome format
pnpm run build-crx      # production bundle + dist_crx/tabverse.zip (store package)
```

## Running the server

```sh
pnpm run server:dev      # 0.0.0.0:8223, ./server/data/tabversed.db
curl -X POST localhost:8223/api/v1/auth/bootstrap -d '{"name":"me"}'
# on the extension: BottomNav -> sync button -> paste URL + pairing code
curl -X POST localhost:8223/api/v1/auth/invites \
     -H 'Authorization: Bearer <token>' -d '{"ttl_seconds":300}'
```

The pasted URL is the machine's address as the *browser* can reach it -
`http://192.168.0.221:8223` from another laptop, not `127.0.0.1`, which would
be the laptop itself. The extension may talk to any http/https/ws/wss server
(`adr/0010`); narrow that at build time with
`TABVERSE_ALLOWED_SERVERS=http://192.168.0.221:8223,https://tv.example.com`.
Note that a device token is a bearer credential: over plaintext `http` on a LAN
it is readable by anything on that network, so use `https://` or a trusted
network.

The server has no Makefile: every build, test and cross-compile target is a
package.json script (`server:dev`, `server:build`, `server:test`, `server:vet`,
`server:fmt`, `server:cross`, `server:docker`). It binds `0.0.0.0:8223` by
default so the extension can be loaded on another machine; set
`TABVERSED_ADDR=127.0.0.1:8223` to keep it local.

See `server/README.md` for configuration, deployment and protocol semantics.

## Accounts, the admin API and the console (`adr/0009`)

The server's data model was tenant scoped from the start (`user_id` on
`records`, `tokens`, `devices`, `invites`, `records_fts`; a per account
`rev_seq`; a per account WebSocket topic; retention over `AllUserIDs()`), but
the only way to create the *first* account was an open `bootstrap` endpoint, so
a deployment could hold exactly one.

`TABVERSED_ADMIN_TOKEN` is what makes it multi tenant, and it gates one
operator surface:

```
                        ┌─ TABVERSED_ADMIN_TOKEN ─┬─ /api/v1/admin/*  (accounts, devices, tokens)
browser ── GET /console ┤                        └─ read only: tabverses, records, search
```

- **unset** (the default) — single tenant, open bootstrap until the first pairer,
  every admin route `404`
- **set** — the console at `/console` provisions accounts, hands out pairing codes,
  revokes leaked devices, and shows what each account stored, **read only**:
  there is no endpoint that edits a user's records, because a record written
  outside the extension would lose the next LWW comparison anyway

**The one write over user data is deleting a tabverse (`adr/0015`).**
`DELETE /api/v1/admin/users/{user_id}/tabspaces/{tabspace_id}?confirm=<id>`
tombstones the tabverse and every record that hangs off it (its tabs, notes,
todos, bookmarks, closed tabs and the three ordering aggregates) and tells the
account's devices, so their next sync removes its copy too - a delete that only
removed the row here would be put straight back by the next push from any
paired browser. It is the extension's own delete widened to a whole tabverse,
not a second implementation: a delete carries no payload to win a comparison
against, so the reason ADR0009 gives for refusing edits does not apply to it.
A typed confirmation is required, the assumed identity is refused it like every
other write, and it is the one audit-log entry that removed somebody's content.

**Operator powers are a fourth tab (`adr/0014`).** Everybody lands on their own
account - Pair Code, Devices & Tokens, Stored data - and an operator also gets
*Admin*: the accounts, with *impersonate*, *make/remove operator* and *delete*
per row. Impersonating switches the three account tabs to that account, read-only
and titled `alice (impersonated by admin)`, and the Admin tab stays put. There is
no create-account path anywhere: registration is the only way an account exists,
so there is one path that can prove an address.

**The account *is* an address (`adr/0017`).** `TABVERSED_ADMIN_EMAIL` is matched
against it to make the first registration the operator, `TABVERSED_LINK_BY_EMAIL`
merges a social login with an existing account by it, and an address nobody has
proved is refused. So Google is registered as a *custom* provider asking for
`profile email` rather than through the auth library's preset, which asks for
profile alone and hands back no address at all - and Google's `email_verified`
proves the address the way following an emailed sign-in link does. GitHub is the
remaining gap: its preset returns no address, so it is unproven.

**Accounts (`adr/0012`, `adr/0013`) are for the console; pairing stays with
the extension. The console has no master credential** - the first registration
with `TABVERSED_ADMIN_EMAIL` is the operator, an operator names others, and every
action is attributable to an account. A first registration also adopts a lone
pre-account sync user, so records synced before accounts existed are not
orphaned.
`internal/accounts` holds the account layer - the account row, the Argon2id
hash (for the password path), the cut-off that revokes sessions, the one function
that bridges the auth library's `<provider>_<subject>` id to our `usr_...` rows,
and the assumed-identity minting behind impersonation. The OAuth2 dance, the JWT
cookie, the XSRF echo and the provider allow-list are go-pkgz/auth/v2's; the
extension is untouched and still pairs with a device token.

A signed-in person lands on their own account and mints their own pairing codes,
which is what removes the operator from the critical path. An operator gets the
account list, a role switch, and **"look as them"**: a 15 minute read-only assumed
identity in its own cookie, so the operator's own session survives, every mutating
route answers 403 while it is on, and entering and leaving are both in
`audit_log`. `TABVERSED_ADMIN_TOKEN` remains as the break-glass path.

`internal/webui` embeds the console's **built** bundle: the app is a Vite/React
project under `server/ui` (`adr/0018`) that compiles into
`internal/webui/dist`, which is generated, not committed, and embedded with
`//go:embed all:dist`. Every Go target runs `pnpm run ui:build` first, so a
binary and its console are one build; a `.gitkeep` in `dist/` keeps the package
compiling on a fresh clone, and a binary built without its UI serves a page that
names the command rather than a blank one. The page is served under
`/console` - shell at `/console`, assets at `/console/assets/<name>-<hash>`,
and `/` answering with a redirect to it (`adr/0023`).

State is effector stores and effects (`server/ui/data/`), the client is a typed
`fetch` wrapper mirroring `api/openapi.yaml`, and the components are Blueprint's
- the same dependency the extension uses, from the same lockfile. The tests are
what a compiler cannot do: vitest over the data layer with a stub `fetch`, and
`react-dom/server` over the views' markup (no DOM, which `AGENTS.md` forbids
installing). `internal/webui/webui_test.go` checks the shell against the files
actually embedded with it, since the names are content hashed.

A tabverse opens in a drawer over the account rather than a page that replaces
it, and it is the extension's own tabverse view in the extension's own two
columns: the tabs on the left, its Todo / Note / Bookmark / History tools on the
right (`adr/0019`). The tab list, the group blocks, the summary line and those
four tools' stylesheets are the extension's own; the panels are read-only, because
a tab stored on this account cannot be opened in the browser running the console
and a record written from here would lose to the next honest sync. The one
button that remains is the delete above. Its stylesheet is the
extension's look - the palette, the 18px cards, the pill buttons and inputs are
transcribed from `src/global.scss` and `src/ui/theme.scss` (nothing imports them
here, so `server/ui/tokens.scss` carries the name of the file each came from),
and the console is light only for the same reason the extension is. The look of
it is still the user's to check (AGENTS.md); the admin API is
`internal/api/admin.go` and its queries are `internal/store/admin.go`. A device
token and the admin token are not interchangeable, and both directions are
tested.

**A console session ends (`adr/0021`).** The session cookie is a stateless
signed JWT, and the library by itself will not let one expire: it ignores a
cookie-borne token's expiry, then mints a fresh one and re-sets the cookie, so a
session slides for as long as it is used. So the bound is enforced here instead,
in `Service.validate` - the `Validator` hook that already carries the account's
revocation cut-off - which the authenticator calls *before* it refreshes.
`TABVERSED_SESSION_TTL` (default `24h`, `0` for no bound) is the length of one
sign-in, and `TABVERSED_SESSION_COOKIE_TTL` defaults to the same number so the
credential leaves the machine when the session does.

Ending every session on demand is `POST /api/v1/console/revoke-sessions`, which
moves `users.tokens_valid_after` - the cut-off `SessionAllowed` already reads on
every request. It is the same credential the extension's device tokens are *not*:
the console's dialog says so, because "sign out everywhere" must not read as
"unpair my devices". A sign-in is audited (`AuditLogin`, written from the
`Set-Cookie` the library emits) because there is no login callback to hook, the
sign-in link is throttled per address and per IP, and "works once" for that link
is kept in `verif_tokens` rather than the library's in-memory map, so it survives
a restart and holds across replicas.

**Archiving (`adr/0011`) is bookkeeping, never deletion.** `archived_at` on
`devices`, `tokens` and `records` hides a row from the console's default views
(tabverse list, record browser, console search, all with `?archived=1` to
include). The record stays stored and keeps syncing to the user's own devices,
and the extension's own search is not filtered - archiving is an operator's
filing decision, not a retention policy. Archiving a *device* is the operator's
decisive teardown: it revokes and archives the device's tokens and then
archives the device, in one transaction and immediately - no inactivity window.
A token archived on its own still has to be revoked first, and a device's
records can only be archived once it has no usable token left. Every accepted
write clears `archived_at`, because a record somebody just changed is live
again.

## Status

- [x] Go server (`tabversed`): auth, delta sync, LWW, tombstones, WebSocket
      fan-out, FTS5 search, retention, tests (`-race`), cross-compile, Docker
- [x] Multi tenant admin API + embedded console, read only over user data
      (`adr/0009`) with one exception: deleting a tabverse, as tombstones the
      devices sync down (`adr/0015`). The console is a Vite/React app built
      into the binary (`adr/0018`)
- [x] Wire contract (`api/openapi.yaml`)
- [x] Client sync layer: outbox, delta engine, realtime, Dexie bridge,
      change feed, pairing dialog (8 test suites)
- [x] MV3 hardening: `storage` permission, tightened CSP,
      `minimum_chrome_version`, `action.default_icon`, module service worker
- [x] Toolchain revamp — Vite 8, React 19, Blueprint 6, Vitest 5, ESLint 10
      flat config (`adr/0003`, `adr/0004`); Prettier 3 later replaced by Biome 2
      for formatting, ESLint kept for linting; TypeScript 7.0.2 for typechecking
      alongside a TypeScript 6 API for typescript-eslint (`adr/0003`)
- [x] draft-js -> TipTap with a tested legacy content converter
- [x] TypeScript strict **subset** enabled (see the comments in
      `tsconfig.json`); dead stores cleaned, ESLint's `no-useless-assignment`
      stays on
- [x] CI: typecheck, format, lint, tests, prod build, store zip + Go
      vet/race/cross-compile
- [x] Store disclosure notes (`doc/chrome-webstore/listing.md`) and the
      privacy policy's "Optional server sync" section
- [x] Existing users' local data uploads when sync is set up, **ticked by
      default and informed**: the dialog counts what would go, unticking keeps
      everything local, and the separate button remains for later (ADR 0002 §3)
- [ ] `strictNullChecks` (428 errors) + `noImplicitAny` (227) — staged pass,
      count first with `npx tsc --noEmit --strict`
- [x] Console revamped from three hand written files into a Vite/React app
      under `server/ui`, built into the Go binary: typed client, effector
      stores, Blueprint components, vitest + `renderToStaticMarkup` instead of
      a hand built stub DOM (`adr/0018`)
- [x] Cross-window machinery deleted: each manager page owns one window, so
      the tabSpaceRegistry (leader election + broadcast-channel) is gone and
      the change feed uses Dexie's own write hooks instead of dexie-observable
      (`adr/0006`)
- [x] Tab previews are a **cache**, and the service worker owns every delete of
      them: rows carry the browser run that wrote them (`chrome.storage.session`,
      because chrome tab ids are recycled between runs), the worker sweeps every
      five minutes and on tab removal, and the manager page no longer prunes at
      all (`adr/0016`)
- [ ] A real run in Chrome: load `dist/` unpacked, pair a server, exercise
      capture -> sync -> search and the note editor
