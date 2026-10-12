# Plan: share a tabverse over the server (read-only link + load into the extension)

Status: **plan** (2026-10). Extension + server + console. Follows the server
pivot (`adr/0001`), privacy (`adr/0002`), the console as a Vite app
(`adr/0018`) and the read-only console view (`adr/0019`). It introduces one new
public data path, so it wants an ADR of its own (`adr/0028`).

## 0. What is being asked

1. A person can **share one tabverse** through the server, from either side:
   - from the **extension**, while the tabverse is open (it is paired);
   - from the **console**, on the tabverse drawer it already shows read-only.
2. When sharing, they **choose what goes in**: tab list, todo, note, bookmark,
   history. Default: **tab list, todo, note**.
3. The share gets a **link**. Opening the link shows the shared tabverse as a
   **read-only view** on the server, with no sign-in.
4. The **extension can read that link and load the tabverse locally**, as a new
   saved tabverse.

## 1. Where we are (all of this exists today)

- **A tabverse is already a document.** `collectTabverseExport` /
  `importTabverse` (`src/data/tabSpace/{export,import}TabSpace.ts`) turn a whole
  tabverse - the tabverse row, its tabs and tab groups, notes, todos, bookmarks,
  history and the three ordering aggregates - into one JSON document
  (`format: "tabverse"`, `version: 1`) and back, reminting every id. This is
  the natural share payload: the server stores it, the extension imports it.
- **The server already holds the same content, decoded.** `GetTabspaceBundle`
  (`internal/store/admin.go:654`) returns the tabverse payload plus every child
  record as `BundleRow{data}` and the ordering aggregates as raw JSON, and the
  console renders exactly that with `server/ui/data/tabverseAdapter.ts` into the
  extension's own `TabverseRecords` (the read-only drawer, `adr/0019`). So the
  server can *build* the share document without asking the extension to upload
  anything.
- **The API is one prefix.** Everything is `/console/api/v1/*` (`adr/0023`); the
  console is a query-routed SPA under `/console` (`server/ui/data/queryRoute.ts`)
  and `webui.Handler` serves the shell for any unknown `/console/<route>`. So a
  public read-only page is a new query key on the existing SPA, not a new site.
- **Two credentials already exist.** A device bearer token (`s.auth`,
  `internal/api/server.go`) and a console session (`s.admin` /
  `consoleCredential`, `internal/api/admin.go:52`). No route accepts both today.
- **The one write over user data is a delete** (`adr/0015`). A share is a second
  one, but it writes a *new* artifact, not the user's records - it does not
  touch the LWW protocol.

## 2. Target

```
extension (paired)                         console (signed in)
  Tabverse ▸ Share…                          Tabverse drawer ▸ Share…
        │                                          │
        │  POST /console/api/v1/shares             │  POST /console/api/v1/shares
        │    {tabspace_id, include:[…]}            │    {tabspace_id, include:[…]}
        └──────────────┬───────────────────────────┘
                       ▼
             server builds a frozen document from GetTabspaceBundle
             stores it under a random id
                       │
       link:  https://host/console?share=<id>
                       │
        ┌──────────────┴───────────────┐
        ▼                              ▼
  browser opens it               extension pastes it
  GET /console/api/v1/shares/<id> GET /console/api/v1/shares/<id>
  → read-only drawer view         → importTabverse(doc) as a new saved tabverse
```

The share page is the console's own read-only tabverse drawer with no account
chrome around it. "Load into Tabverse" is a paste-the-link action in the
extension, not a server push.

## 3. Decisions

| # | Question | Decision |
|---|----------|----------|
| D1 | Snapshot or live? | **Snapshot.** A share is what you chose to share, frozen at the moment you shared it. Revocation is then a single row, the public read never opens a per-user database, and the extension's import is a plain document. Re-sharing (or `PUT` refresh) updates it; a live share is a later option, not this one. |
| D2 | Who builds the document? | **The server**, from `GetTabspaceBundle`, so both initiators work the same way. The extension flushes its outbox first (best effort) so the snapshot is current; it does not upload a document. |
| D3 | What format is the document? | **The existing `.tabverse` export** (`TabverseExport`, `format:"tabverse"`, `version:1`). The extension imports it with `parseTabverseExport` + `importTabverse` unchanged; the console converts it to the `TabspaceBundle` shape `tabverseAdapter` already draws (a ~40-line adapter, D8). |
| D4 | Where is it stored? | **Central `shares` table**, as a size-capped JSON blob, with `user_id`/`tabspace_id`. This is a deliberate exception to `adr/0027`: a share is a frozen, user-published artifact, not the user's synced content, and keeping it central is what makes an anonymous read cheap (no per-user database is opened for a stranger) and revocation atomic. The ADR records the exception. |
| D5 | How is it addressed? | A **capability id**: 128 random bits, base64url. `GET /console/api/v1/shares/<id>` needs no credential. Unguessable, revocable, optional expiry. |
| D6 | Include selection | A closed set `tabs · todos · notes · bookmarks · history`, default `["tabs","todos","notes"]`. The tabverse row is always present (it is the container); excluding `tabs` empties its `tabs`/`tabGroups` but keeps the name. Each group maps to entities (see §4). |
| D7 | Which credential creates it? | A new **self** middleware that accepts a device bearer token *or* a console session, and normalises both to one user id in the request context. A mutating request is refused while an operator is impersonating (same rule as the console). |
| D8 | How does the console draw it? | Convert the share document to a `TabspaceBundle` and hand it to the existing `TabverseDrawer` / `tabverseAdapter`. One adapter, no second view to keep in step. |
| D9 | How does the extension load it? | Paste the link (or the API URL) into a "Load shared tabverse" box; the extension fetches the public document and calls `importTabverse`. No pairing is needed to *read* a share. A console→extension message channel ("Open in Tabverse") is a follow-up, not v1. |
| D10 | Author identity | Not in the document by default. A share is content, not a profile. The console may show the share's own title and timestamps only. |
| D11 | Refresh semantics | `PUT /console/api/v1/shares/<id>` re-reads the live bundle and rewrites the snapshot (and may change `include`). It does not change the id or the link. |

Two of these are chosen with §15 in mind, so stage 1 does not foreclose a
collaborative stage 2: the snapshot is an **interchange document** (D3), and a
later "make this editable" is a mode on the same object rather than a new one.
§15.8 is the checklist to keep in mind while building this.

## 4. The share document

`TabverseExport` (unchanged), filtered by `include`:

| include | entities read | document fields |
|---|---|---|
| `tabs` | `tabspace`, `tab` | `tabverse` (+ `tabIds`, `tabGroups`), `tabs` |
| `todos` | `todo`, `alltodo` | `todos`, `aggregates.allTodo` |
| `notes` | `note`, `allnote` | `notes`, `aggregates.allNote` |
| `bookmarks` | `bookmark`, `allbookmark` | `bookmarks`, `aggregates.allBookmark` |
| `history` | `closedtab` | `history` |

The tabverse row is always emitted; excluded groups emit `[]` and `null`
aggregates, so `importTabverse` still produces a valid tabverse (an empty tool
for a group that was not shared, which is the honest thing to show).

Server side this is one function, `bundleToExport(bundle, include)`: the
`BundleRow.data` is the record payload, the aggregates are the raw JSON already
in `bundle.aggregates`, and `bundle.tabs` are ordered by `position`.

## 5. Data model

A new table in the **central** database (`internal/store/store.go`, beside
`users`/`devices`/`tokens`):

```sql
CREATE TABLE IF NOT EXISTS shares (
  id          TEXT PRIMARY KEY,      -- the capability id
  user_id     TEXT NOT NULL,
  tabspace_id TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  include     TEXT NOT NULL DEFAULT '[]',
  document    TEXT NOT NULL,         -- the frozen TabverseExport JSON
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  revoked_at  INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS shares_user ON shares(user_id, created_at DESC);
```

`title` is the tabverse name at snapshot time (so the public view and the list
do not need the document to label a row). `revoked_at`/`expires_at` are
checked on the public read; a revoked or expired share is a `404`, exactly like
one that never existed (no oracle).

## 6. API

All under `/console/api/v1`, all JSON, all errors through `writeErr`.

| method | path | auth | body / result |
|---|---|---|---|
| `POST` | `/shares` | self (D7) | `{tabspace_id, include?, title?}` → `{share}` |
| `GET` | `/shares` | self | `?limit=&offset=` → `{shares:[…], total}` |
| `GET` | `/shares/{id}` | **public** | → `{share, document}` |
| `PUT` | `/shares/{id}` | self | `{include?}` → `{share}` (re-snapshot, D11) |
| `DELETE` | `/shares/{id}` | self | → `204` (soft revoke) |

`share` (summary, no document):

```json
{ "id": "…", "tabspace_id": "…", "title": "Recipes",
  "include": ["tabs","todos","notes"],
  "counts": { "tabs": 7, "todos": 3, "notes": 2, "bookmarks": 0, "history": 12 },
  "created_at": 0, "updated_at": 0, "expires_at": 0,
  "path": "/console?share=<id>" }
```

`path` is relative on purpose: the extension prepends its configured `baseUrl`,
the console prepends `location.origin`, and the server never has to guess how it
is reached from outside (`cfg.PublicURL` may be unset on a LAN).

Rules:

- `include` is validated against the closed set; an unknown value is a `400`.
- The tabverse must belong to the caller and be live (`GetTabspaceBundle` → 404
  otherwise), so a share can never point at somebody else's tabverse.
- The marshalled document is capped by a new `TABVERSED_SHARE_MAX_BYTES`
  (default 4 MiB, larger than one record): a `413` rather than an unbounded
  central-DB blob.
- The public read sets `Cache-Control: no-store` and `X-Robots-Tag: noindex`
  (revocation must be immediate, and a capability URL must not be indexed), and
  is throttled per IP with the existing `newThrottle` (see `signinByIP`).

`internal/api/shares.go` holds the handlers; `internal/store/shares.go` holds
the table access. The route table (`internal/api/server.go`) gains:

```go
mux.HandleFunc("POST /console/api/v1/shares", s.self(s.handleCreateShare))
mux.HandleFunc("GET /console/api/v1/shares", s.self(s.handleListShares))
mux.HandleFunc("GET /console/api/v1/shares/{id}", s.handleGetShare)   // public
mux.HandleFunc("PUT /console/api/v1/shares/{id}", s.self(s.handleRefreshShare))
mux.HandleFunc("DELETE /console/api/v1/shares/{id}", s.self(s.handleRevokeShare))
```

`self` (D7): if `extractToken` finds a bearer token, run `s.auth`; otherwise run
the session resolver and put the account id in the same `ctxKeyUser` slot, so
every handler reads `userIDFrom(r.Context())` and nothing else. The session
branch keeps `refuseIfAssumedAndMutating`, so an impersonating operator cannot
create or revoke a share.

## 7. Server work

1. `internal/store/shares.go` - `CreateShare`, `ListShares`, `GetShare`,
   `RefreshShare`, `RevokeShare`, and `CountShares` for the list; all
   `user_id`-scoped, all returning `ErrNotFound` for a stranger's id.
2. `internal/store/store.go` - the `shares` table + index in the central schema.
3. `internal/store/export.go` (or a method on `Store`) - `bundleToExport`,
   shared by create and refresh; unit-tested on its own (it is a pure transform
   of a bundle plus an include list).
4. `internal/api/shares.go` - the five handlers, `include` validation, the size
   cap, the public read's headers and throttle.
5. `internal/api/server.go` - `self` middleware and the five routes.
6. `internal/config/config.go` - `ShareMaxBytes`.
7. `api/openapi.yaml` - the five paths, the `Share`/`ShareDocument` schemas, and
   the two auth modes on `POST`/`GET`/`PUT`/`DELETE` vs the public `GET`.

## 8. Console work

1. `server/ui/data/types.ts` - `Share`, `ShareDocument` (= the extension's
   `TabverseExport`), `ShareList`.
2. `server/ui/data/api.ts` - `createShare`, `listShares`, `getShare` (public,
   no session), `refreshShare`, `revokeShare`.
3. `server/ui/data/shareAdapter.ts` - `exportToBundle(document)` so the existing
   `tabverseAdapter` + `TabverseRecords` draw it (D8). Tested with a fixture,
   like `tabverseAdapter.test.ts`.
4. `server/ui/views/ShareView.tsx` + a `?share=<id>` branch in `App.tsx`/the
   route reader: the read-only drawer, the share's title and "shared N ago", a
   note that it is read-only, and the extension load hint. No account chrome,
   no sign-in. A missing/revoked id is a small "this share is gone" page.
5. `server/ui/views/tabverse/TabverseDrawer.tsx` - a **Share** button opening a
   small panel: the five include checkboxes (tab list / todo / note / bookmark /
   history, the first three ticked), **Create link**, the resulting link with a
   copy button, and **Revoke** for an existing one.
6. `server/ui/data/stores/shares.ts` - the dialog's state and effects, in the
   existing store style.
7. Optional: a **Shares** section in `AccountView.tsx` listing the account's
   shares with open/revoke.

## 9. Extension work

1. `src/data/repo/types.ts` - `Share`, `ShareSummary`, `ShareDocument`.
2. `src/data/repo/serverApi.ts` - `createShare`, `listShares`, `getShare`
   (public; a client with no token), `refreshShare`, `revokeShare`.
3. `src/data/repo/shareTabverse.ts` - `shareTabverse(tabSpaceId, include)`:
   flush the outbox (best effort, via the sync engine's `syncOnce`), call
   `createShare`, return the link. `loadSharedTabverse(url)` - parse the id out
   of a share link or accept an id, fetch the public document, and hand it to
   `importTabverse`. Both dependency-free (no `chrome`), so both are unit tested
   with a stub fetch.
4. `src/ui/manager/.../ShareTabverseDialog.tsx` - the include checkboxes, create,
   the link + copy, revoke. Opened from the tabverse's right-side panel
   (`TabSpaceRightSideView`) and/or the saved-tabverse view. Disabled with "Set
   up server sync first" when `useServerSyncConfigured` is false.
5. Popup / Saved view - a **Load shared tabverse** action: a one-line box that
   takes a share link, fetches, imports, and reports `Imported "<name>"` the way
   the file import already does.
6. No manifest change: the extension already fetches its paired server, and a
   public share read is the same origin.

## 10. Privacy and security

- **Opt-in per share, per group.** Nothing is shared unless a person creates a
  share, and the default excludes bookmarks and history (the two most likely to
  hold private pages).
- **A capability URL is a secret.** The id is 128 random bits and must be
  treated like one: `noindex`, `no-store`, `Referrer-Policy: no-referrer`
  (already set by `webui.Handler`), and a note in the UI that anyone with the
  link can read it.
- **Revocation is immediate** (`revoked_at` checked on every read), and deleting
  the tabverse does **not** silently keep a share alive - creating a share
  records `tabspace_id`, and `adr/0015`'s delete path should revoke that
  account's shares for the tabverse in the same transaction (a follow-up item in
  §12).
- **No account leak:** the document carries the tabverse's own name and rows,
  never the account id, name or email.
- The public read is throttled and size-capped; the snapshot is capped at write
  time so a single share cannot bloat the central database.
- Update `doc/chrome-webstore/listing.md` and the privacy policy's server
  section to name the new outbound path ("you can publish a tabverse as a
  read-only link").

## 11. Testing

- **Go** (`server/`): store CRUD and scoping (a stranger's id is `ErrNotFound`);
  `bundleToExport` per include (including "tabs excluded" and "only history");
  handler tests for create/list/get/refresh/revoke, public get, revoked/expired
  → 404, unknown include → 400, size cap → 413, impersonation refused, and both
  credentials accepted (`s.auth` device token and a session). `go test -race`.
- **Console** (`server/ui`): `shareAdapter.test.ts` (a document → the bundle the
  drawer draws), `api.test.ts` for the new calls, and `renderToStaticMarkup`
  over `ShareView` (present, gone) and the share panel - no DOM, per `AGENTS.md`.
- **Extension**: `shareTabverse.test.ts` (create request/response, link parsing,
  `loadSharedTabverse` → a new tabverse), `serverApi.test.ts` for the new
  methods. `pnpm test`, `typecheck`, `lint:check`, `format:check`, `build`.

## 12. Work items, in order

1. **ADR 0028** - capability snapshots, central storage exception, the public
   path. Write it before the code.
2. **Store** - table, `internal/store/shares.go`, `bundleToExport`, tests.
3. **API** - `self` middleware, five routes, handlers, config, openapi, tests.
4. **Console read path** - `shareAdapter`, `ShareView`, the `?share=` route,
   `getShare` in the api client, markup tests.
5. **Console write path** - the drawer's Share panel, create/revoke, stores.
6. **Extension read path** - `loadSharedTabverse` + the popup "load from link".
7. **Extension write path** - `shareTabverse` + the share dialog.
8. **Tie-offs** - revoke a tabverse's shares on `adr/0015` delete; the webstore
   listing and privacy policy; a real run in Chrome (load `dist/`, pair, share,
   open the link in another profile, load it back).

A cross-cutting rule while building all of it: see §15.8. Stage 1 is a snapshot,
so it can be built exactly as written - but nothing new should key off `user_id`
in a way a `space_id` could not slot into later, and `server_at` stays
authoritative in the schema so moving to a server clock is a server change.

## 13. Files

| Path | What |
|---|---|
| `doc/tabverse-share-tabverse-plan.md` | this plan |
| `adr/0028-…` | the decision record |
| `server/internal/store/shares.go` | the `shares` table access |
| `server/internal/store/store.go` | the central schema (+ `shares`) |
| `server/internal/store/export.go` | `bundleToExport` |
| `server/internal/api/shares.go` | the five handlers + `self` |
| `server/internal/api/server.go` | routes + `self` |
| `server/internal/config/config.go` | `ShareMaxBytes` |
| `api/openapi.yaml` | the share paths and schemas |
| `server/ui/data/{types,api}.ts` | the console client |
| `server/ui/data/shareAdapter.ts` | document → `TabspaceBundle` |
| `server/ui/views/ShareView.tsx` | the public read-only page |
| `server/ui/views/tabverse/TabverseDrawer.tsx` | the Share button/panel |
| `src/data/repo/{types,serverApi}.ts` | the extension client |
| `src/data/repo/shareTabverse.ts` | create + load |
| `src/ui/manager/.../ShareTabverseDialog.tsx` | the extension share UI |
| `src/ui/popup/PopupView.tsx` | "Load shared tabverse" |

## 14. Gotchas and open questions

- **One manager page per window** (`adr/0006`): importing a shared tabverse only
  saves a new row (like the file import); it never opens a window, so no
  `CountExit` interaction.
- **The extension's copy may be ahead of the server.** D2 has the server build
  the snapshot, so the share is the *synced* tabverse; the extension's share
  action flushes the outbox first to keep that gap small. If a person shares
  offline, the request fails and nothing is stored - which is honest.
- **The public read opens no per-user database** (D4), which is also the reason
  the central table is the right home for the snapshot.
- **Open:** should a share expire by default (e.g. 30 days), or only when
  revoked? Leaning **no default expiry**, with an optional `expires_at` in the
  API.
- **Open:** should the console-initiated share be allowed while impersonating?
  This plan says no (D7); an operator can stop impersonating first.
- **Open:** the console page's `?share=` route is public, but the SPA still
  boots the whole account shell. If that proves heavy, a tiny separate route or
  a server-rendered page is a later option; the query key keeps it cheap for now.

## 15. If this is meant to become collaborative

A read-only share is stage one of a bigger thing, and the bigger thing is not a
bigger share: it is a change to *who owns a tabverse*. Below, ordered by how
hard it is to undo.

### 15.1 The unit of collaboration is the saved tabverse, not the window

A tabverse is one window's page (`adr/0006`): it tracks the live tabs of the
window it is open in, one manager page per window, and its `chromeTabId`s are
session-scoped. Two people cannot both own that window, and the same url in two
windows is two tabs. So "collaborate" cannot mean "one live tab list
everywhere"; it means a **shared saved workspace** - todos, notes, bookmarks,
history, and the tab list as a reference - that each collaborator loads into
their own window (the merge we already have, `planRestore`) and saves back. That
reframes the feature as async fork/merge, with realtime as an enhancement on the
tools, not on the tabs.

### 15.2 The ownership boundary has to move (the hard one)

Today a tabverse belongs to one `user_id`, and the content lives in that user's
database (`adr/0027`), pooled under an FD budget. Collaboration needs the
tabverse to belong to a **space** with members:

- a `spaces` + `space_members(role)` table in the central DB;
- records scoped by `space_id`, not `user_id`;
- the per-user DB becomes a per-space DB (or a second pool), which changes
  `adr/0027`'s pooling, the FD budget (`internal/rlimit`) and the counter cache
  (`adr/0026`) - all of which assume "one content file per account".

This is the first decision, because every layer (sync, search, retention, the
console's `resolveScope`, the WebSocket topic) keys off `user_id` today. A
snapshot share touches none of it; collaboration touches all of it.

### 15.3 Multi-writer sync, where the current protocol is weakest

The delta protocol is last-writer-wins per record on a **client clock**
(`updated_at`, `records.go`). For one person's devices that is fine; for several
people it is not, in three places:

1. **Clocks.** A device with a fast clock wins every conflict. The server
already stores `server_at`; a hybrid logical clock assigned at accept time (or
`server_at` as the tiebreak) removes the assumption.
2. **Aggregate rows.** `tabIds`, `allnote`, `alltodo`, `allbookmark` are *whole
lists in one row*: two people reordering or adding at once, and one list
clobbers the other. Real collaboration wants the order in each row (a fractional
`position`), so inserts and moves merge instead of overwrite. This is cheapest to
introduce **before** the format is shared widely - the import/export and the
console adapter both read the aggregates today.
3. **Rich text.** Two people in one note is beyond LWW: either a CRDT (Yjs /
Automerge - a real dependency, against this repo's grain) or a coarser rule
(per-block LWW, or an edit lock). Decide by what "collaborate" must mean for
notes.

Todos, bookmarks and history are per-row records and tolerate LWW; the ordering
and the notes are the parts that do not.

### 15.4 Identity, roles, and the two kinds of access

- A **capability link** (this plan) is anonymous, read-only, revocable - it stays
as the "publish" mode and needs no membership.
- **Membership** is signed-in, has a role (`owner` / `editor` / `viewer`),
appears in an invite flow, and is what `accounts`, `devices` and `audit_log`
already have the pieces for.
- Every shared record wants an **actor** (`user_id`, not just `device_id`) so the
UI can say who changed what; the hub's message envelope already has room.

### 15.5 Realtime and presence

`internal/hub` fans out per `user_id` today; collaboration fans out per
`space_id` (a topic key, not a second hub). Presence ("X is viewing", "X is
editing a note"), cursors and activity are additive message types on the same
socket. Notifications (`accounts/sender.go`) are the async half.

### 15.6 Privacy and the product stance

`adr/0002` is built on "your content is yours"; a shared space is a deliberate
hole in that. It needs an ACL the owner can see and revoke, a
leave/remove-member path, audit entries for membership changes, and a
privacy-policy sentence that is true ("a tabverse you share with people is
stored for those people"). The snapshot share's `noindex`/`no-store` rules stay
for the public link; membership content is not public and is served only to
members.

### 15.7 Staging, so none of this has to be built at once

| stage | what it adds | what it touches |
|---|---|---|
| **1. snapshot share** (this plan) | a read-only link | central `shares` only |
| **2. membership + edit** | spaces, roles, `space_id`-scoped records, actor | store, sync, search, hub, console scope |
| **3. realtime** | per-space topics, presence, HLC, per-row order | sync, hub, ordering format |
| **4. rich collaboration** | CRDT notes, comments, notifications | a new dependency and a new entity |

### 15.8 What to decide now, while stage 1 is cheap

- Keep the **share document an interchange format** (it is a versioned
`TabverseExport`), so a later "make this share editable" is a mode on the same
object, not a new one.
- Model the **scope** generically in the API (`POST /shares` today; a `space`
concept later) so `user_id` is not baked into yet another route.
- Do not deepen the **single-owner** assumption: anything new that keys off
`user_id` (search, counters, retention, `resolveScope`) should be written so a
`space_id` can slot in.
- Treat **`updated_at` as a client hint** and keep `server_at` authoritative in
the schema, so moving to a server clock is a server change, not a re-sync of
every device.
- If collaboration is likely soon, move the **ordering lists** to per-row
`position` before more people hold the current format - that migration only gets
more expensive.
