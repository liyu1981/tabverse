# Plan: share a tabverse (RBAC, read-only first)

Status: **plan** (2026-10). Extension + server + console. Follows the server
pivot (`adr/0001`), privacy (`adr/0002`), accounts (`adr/0012`/`adr/0013`), the
read-only console view (`adr/0019`) and the per-account content database
(`adr/0027`). It introduces cross-account read access, so it wants an ADR of its
own (`adr/0028`).

## 0. What is being asked

1. A person can **share one of their tabverses** with **other accounts on the
   same server**.
2. Permissions live in an **RBAC table in the central database**: a share says
   *who* may do *what* to *which* tabverse.
3. Two **share modes**:
   - **read-only** - another authenticated user may **read** this tabverse once
     RBAC allows it. **This is the one to build now.**
   - **editable** - another user may **modify** it. Design later; the model
     must be prepared for it (a mode, a role, and a marker that carry it).
4. In the **per-account content database**, a shared tabverse carries a **mark**
   that it is shared - the **local truth** for the share, next to the content it
   is about.
5. The tabverse can be shared from the **extension** or from the **console**.

## 1. Where we are (grounded)

- **Content is per account** (`adr/0027`): `records` / `records_fts` / `user_meta`
  live in a per-account SQLite file under `TABVERSED_USERS_DIR`, opened through
  the `UserDBs` pool. `UserDB` has its own versioned migrations
  (`internal/store/userdb.go`, `PRAGMA user_version`), so a new per-user table is
  one migration step.
- **The server can already read a whole tabverse**: `GetTabspaceBundle`
  (`internal/store/admin.go:654`) returns the tabverse payload, every child
  record as decoded `BundleRow`s, and the ordering aggregates - the console
  draws exactly that (`adr/0019`).
- **Two credentials already exist**: a device bearer token (`s.auth`) and a
  console session (`s.admin` / `consoleCredential`). No route accepts both yet.
- **The document format already exists**: `TabverseExport`
  (`src/data/tabSpace/exportTabSpace.ts`) is the portable, id-reminting
  representation of a tabverse, and `importTabverse` consumes it.
- **The central schema** is `internal/store/store.go` (`users`, `devices`,
  `tokens`, `invites`, `identities`, `audit_log`, counters). The RBAC and share
  tables go here.
- **Realtime** is `internal/hub` (per-`user_id` topics), and **accounts** are
  `internal/accounts`.

## 2. The model

A **share** is one tabverse, shared by its owner, with:

| part | where | what |
|---|---|---|
| **mode** | central `shares` | `readonly` (built now) or `editable` (reserved) |
| **include** | central `shares` | which groups travel: `tabs`, `todos`, `notes`, `bookmarks`, `history` |
| **grants** | central `rbac_grants` | `(subject account, role)` - the RBAC table |
| **marker** | owner's per-account DB | the tabverse is shared, its mode and include - **the local truth** |

**Roles** are ordered: `viewer` < `editor`. A mode bounds the roles it allows:
`readonly` → `viewer` only; `editable` → `viewer` or `editor`. The read path
asks for `viewer`; a future write path asks for `editor`.

```
owner account                         grantee account
  per-account DB                        (any paired device / console session)
   records(… tabverse …)  ◄── read ──┐
   shared_tabverses(mark)  ◄─ truth ─┤
                                     │  auth: device token or session → user
  central DB                         │  RBAC: rbac_grants(share, subject, role)
   shares(owner, tabspace, mode, include)
   rbac_grants(share, subject, role) ─┘
```

The share is **live**: the read path reads the owner's current records and
filters them by `include`. There is no snapshot to keep in step; the owner's
database is the source of truth, and the marker is what says so.

## 3. Decisions

| # | Question | Decision |
|---|----------|----------|
| D1 | Snapshot or live? | **Live.** The share reads the owner's current tabverse (filtered by `include`). The per-account DB is the truth; there is nothing to refresh and no second copy to revoke. |
| D2 | Anonymous link or authenticated? | **Authenticated.** A grantee must be an account on the same server and pass an RBAC check. There is no capability URL and no anonymous read. |
| D3 | Where do permissions live? | **An RBAC table in the central DB** (`rbac_grants`), one row per `(share, subject account, role)`. A companion `shares` row holds the mode and include. |
| D4 | What is the "local truth"? | A **marker row in the owner's per-account DB** (`shared_tabverses`), written by the server when the share is created or changed. The read path consults it after RBAC; a central row with no marker is a `404`, not access. |
| D5 | Who may read? | Any account with a non-revoked `viewer` (or `editor`) grant on the share, authenticated with a device token or a console session. |
| D6 | How does a grantee get a grant? | The owner names accounts by **email** (resolved in the central `users`); the server inserts the grant. Inviting an unknown address is out of scope for v1 (it would need the registration/email flow). |
| D7 | What document does the read return? | The **`TabverseExport` document** (filtered by `include`), so the extension imports it with `importTabverse` unchanged. The console converts it to the `TabspaceBundle` shape its drawer already draws. |
| D8 | How is `include` enforced? | The server filters the bundle to the chosen groups before building the document; an excluded group is `[]`/`null` (a valid but empty tool). |
| D9 | Where is it initiated? | Both, over the same API: a **Share** panel in the extension and on the console's tabverse drawer. |
| D10 | Editable now? | **No.** `mode: editable` and `role: editor` exist in the schema and API validation, and the read path already accepts an editor. The write path is a later change (see §11). |
| D11 | Realtime | A grant change publishes on the owner's and grantees' hub topics (`records_changed` for the owner, a new `shares_changed` for grantees) so an open "Shared with me" list redraws. |

## 4. Data model

### Central DB (`internal/store/store.go`)

```sql
CREATE TABLE IF NOT EXISTS shares (
  id            TEXT PRIMARY KEY,          -- opaque, "shr_…"
  owner_user_id TEXT NOT NULL,
  tabspace_id   TEXT NOT NULL,
  mode          TEXT NOT NULL,             -- 'readonly' | 'editable'
  include       TEXT NOT NULL,             -- JSON array of group names
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  revoked_at    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (owner_user_id, tabspace_id)
);

-- the RBAC table: subject → role on a share
CREATE TABLE IF NOT EXISTS rbac_grants (
  id              TEXT PRIMARY KEY,        -- "grn_…"
  share_id        TEXT NOT NULL,
  subject_user_id TEXT NOT NULL,
  role            TEXT NOT NULL,           -- 'viewer' | 'editor'
  granted_by      TEXT NOT NULL,
  granted_at      INTEGER NOT NULL,
  revoked_at      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (share_id, subject_user_id)
);
CREATE INDEX IF NOT EXISTS rbac_subject ON rbac_grants(subject_user_id, revoked_at);
CREATE INDEX IF NOT EXISTS rbac_share   ON rbac_grants(share_id, revoked_at);
```

`include` is validated against the closed set
`tabs · todos · notes · bookmarks · history`, default `["tabs","todos","notes"]`.
The tabverse row itself is always part of the document (it is the container).

### Per-account DB (`internal/store/userdb.go`, migration → 2)

```sql
CREATE TABLE IF NOT EXISTS shared_tabverses (
  tabspace_id TEXT PRIMARY KEY,
  mode        TEXT NOT NULL,
  include     TEXT NOT NULL DEFAULT '[]',
  shared_at   INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  revoked_at  INTEGER NOT NULL DEFAULT 0
);
```

This is the **mark**. The server writes it when a share is created, updated or
revoked. It is what makes the owner's own content database the authority on
"this tabverse is shared": the read path checks it after RBAC, and a central
share whose marker is gone is stale (a `404`, cleaned up lazily).

## 5. API

All under `/console/api/v1`, JSON, errors through `writeErr`.

| method | path | auth | body / result |
|---|---|---|---|
| `POST` | `/shares` | self | `{tabspace_id, mode, include?, grantees?}` → `{share}` |
| `GET` | `/shares` | self | shares I own |
| `GET` | `/shares/incoming` | self | shares granted to me |
| `GET` | `/shares/{id}` | self + RBAC | `{share, document}` - the read path |
| `PUT` | `/shares/{id}` | self (owner) | `{mode?, include?, grantees?}` → `{share}` |
| `DELETE` | `/shares/{id}` | self (owner) | `204` (revoke the whole share) |
| `DELETE` | `/shares/{id}/grants/{subject_user_id}` | self (owner) | `204` (revoke one grant) |

`share` (no document):

```json
{ "id": "shr_…", "owner_user_id": "usr_…", "tabspace_id": "…",
  "mode": "readonly", "include": ["tabs","todos","notes"],
  "counts": { "tabs": 7, "todos": 3, "notes": 2 },
  "created_at": 0, "updated_at": 0,
  "grants": [ { "subject_user_id": "usr_…", "email": "a@b.c", "role": "viewer" } ] }
```

`grantees` in the request is `[{ "email": "a@b.c", "role": "viewer" }]`; the
server resolves each email to an account and rejects an unknown one with a
`400`. `role` defaults to `viewer`.

**The `self` middleware (D5).** A new `s.self` accepts a device bearer token
(`s.auth`) or a console session, and normalises both to one user id in the
request context, so every handler reads `userIDFrom(r.Context())`. The session
branch keeps `refuseIfAssumedAndMutating`, so an impersonating operator cannot
create, change or revoke a share.

**RBAC check.** `requireShareRole(ctx, subject, shareID, minRole)`:
load the share (not revoked), find a non-revoked grant for `subject`, and
require `role >= minRole` with the share's mode permitting that role. A miss is
`404` (not `403`): a share the caller cannot see should not be distinguishable
from one that does not exist.

## 6. The read path

`GET /console/api/v1/shares/{id}`:

1. **Auth** → caller's `user_id` (device token or session).
2. **RBAC** → `requireShareRole(caller, id, viewer)`.
3. **Local truth** → open the owner's per-account DB (pool), read
   `shared_tabverses[tabspace_id]`; if absent or revoked → `404`.
4. **Content** → `GetTabspaceBundle(owner, tabspace_id)` (live).
5. **Filter** → build the `TabverseExport` document from the bundle, keeping
   only the groups in `include` (§8).
6. Return `{share, document}`. **The path never writes to the owner's database.**

The extension calls the same endpoint and hands `document` to `importTabverse`.
The console calls it and converts `document` to a `TabspaceBundle` for its
existing read-only drawer.

## 7. Server work

1. **Central store** - `internal/store/shares.go`: `CreateShare` (upsert share +
   grants), `ListShares` (owned), `ListIncoming` (granted to a subject),
   `GetShare`, `UpdateShare`, `RevokeShare`, `RevokeGrant`, `ResolveEmail` (or
   reuse the accounts lookup), and the RBAC query `RoleFor(subject, shareID)`.
2. **Central schema** - the two tables in `store.go`.
3. **Per-user store** - migration → 2 (`shared_tabverses`) and
   `SetShareMark` / `ClearShareMark` / `ShareMark` on `UserDB`.
4. **`bundleToExport`** - a pure transform from a `TabspaceBundle` plus an
   `include` list to a `TabverseExport` document (unit-tested on its own).
5. **Handlers** - `internal/api/shares.go`: the seven routes, `include`/`mode`/
   `role` validation, the `self` middleware, the RBAC helper, the read path, and
   the hub publish.
6. **Routes + config** - `internal/api/server.go`; nothing to configure (a share
   is not size-capped the way a snapshot was).
7. **OpenAPI** - the seven paths, the `Share`/`ShareGrant`/`ShareDocument`
   schemas, and the self-auth note.
8. **Audit** - `share_created`, `share_updated`, `share_revoked`, `grant_added`,
   `grant_revoked`, each naming the owner as actor.

Ordering across the two databases (they are separate SQLite files, so no shared
transaction): on create/update write the **per-user marker first**, then the
central rows (a crash leaves a marker with no grant - no access); on revoke
clear the **central rows first**, then the marker (access stops immediately).
Orphan markers are cleaned lazily on the next read.

## 8. `include` → entities

| group | entities read | document fields |
|---|---|---|
| `tabs` | `tabspace`, `tab` | `tabverse` (+ `tabIds`, `tabGroups`), `tabs` |
| `todos` | `todo`, `alltodo` | `todos`, `aggregates.allTodo` |
| `notes` | `note`, `allnote` | `notes`, `aggregates.allNote` |
| `bookmarks` | `bookmark`, `allbookmark` | `bookmarks`, `aggregates.allBookmark` |
| `history` | `closedtab` | `history` |

## 9. Console work

1. `server/ui/data/types.ts` - `Share`, `ShareGrant`, `ShareDocument`
   (= the extension's `TabverseExport`), `ShareList`.
2. `server/ui/data/api.ts` - `createShare`, `listShares`, `listIncoming`,
   `getShare` (read), `updateShare`, `revokeShare`, `revokeGrant`.
3. `server/ui/data/shareAdapter.ts` - `exportToBundle(document)` so the existing
   `tabverseAdapter` + `TabverseRecords` draw it (D7).
4. `TabverseDrawer.tsx` - a **Share** button opening a panel: mode (read-only;
   editable shown disabled with "coming soon"), the five include checkboxes
   (tab list / todo / note / bookmark / history, the first three ticked), a
   grantee list (email + role, add/remove), **Share**, and **Revoke**.
5. A **Shared with me** section (own account) listing incoming shares, each
   opening the read-only drawer.

## 10. Extension work

1. `src/data/repo/types.ts` - `Share`, `ShareGrant`, `ShareDocument`.
2. `src/data/repo/serverApi.ts` - the seven client methods.
3. `src/data/repo/shareTabverse.ts` (dependency-free, unit-tested):
   - `shareTabverse(tabSpaceId, mode, include, grantees)` → the share;
   - `listShares()` / `listIncomingShares()`;
   - `loadSharedTabverse(shareId)` → fetch the document and `importTabverse` it;
   - `revokeShare(shareId)`.
4. `ShareTabverseDialog.tsx` - mode, include checkboxes, grantee emails, and the
   result (the share, with a revoke). Opened from the tabverse's right-side
   panel; disabled with "Set up server sync first" when not paired
   (`useServerSyncConfigured`).
5. A **Shared with me** list (sidebar or popup): incoming shares, each with
   **Open read-only** (a read-only view reusing the saved-tabverse cards) and
   **Load to local** (`loadSharedTabverse` → a new saved tabverse named
   `Imported: …`).
6. A **shared** badge on owned tabverses that appear in `GET /shares`.
7. No manifest change: the extension already reaches its paired server.

## 11. Editable: what is reserved now

- **Schema**: `shares.mode` accepts `editable`; `rbac_grants.role` accepts
  `editor`; the per-user marker carries the mode. Nothing has to be re-shaped
  later.
- **Read path**: `requireShareRole(..., viewer)` already passes for an `editor`,
  so an editor can read today.
- **Write path (later)**: a grantee writing to the owner's per-account DB. This
  is the hard part and is deliberately deferred - it re-opens multi-writer
  conflict resolution, attribution (`user_id`, not just `device_id`), and the
  aggregate rows (`tabIds`, `allnote`, `alltodo`, `allbookmark`) that two writers
  would clobber. §16 has the full list.
- **Reserved endpoint**: `PUT /shares/{id}/content` answers `501 not_implemented`
  until then, so the shape is visible in the contract without a half-working
  write.

## 12. Privacy and security

- **No anonymous access.** Every read is authenticated and RBAC-checked; there
  is no capability URL to leak.
- **The owner is in control**: grantees are named accounts, the list is visible,
  and any grant or the whole share can be revoked at once.
- **A grantee reads live content**, so revoking a grant or the share stops the
  next read immediately (central rows are cleared first).
- **A miss is a `404`, not a `403`**, so the existence of somebody else's share
  is not an oracle.
- **Audit** every grant change; the actor is the owner.
- Update `doc/chrome-webstore/listing.md` and the privacy policy to name the new
  path ("a tabverse you share is readable by the accounts you name").

## 13. Testing

- **Go**: store CRUD and scoping (a stranger's share is `ErrNotFound`); the RBAC
  query (viewer/editor, revoked, wrong subject, mode bound); `bundleToExport`
  per include; the read path (owner and grantee, marker present/absent, revoked);
  `self` auth with both credentials; impersonation refused; the cross-DB ordering
  (create/revoke). `go test -race`.
- **Console**: `shareAdapter.test.ts`; `api.test.ts` for the new calls;
  `renderToStaticMarkup` over the share panel and the read-only view.
- **Extension**: `shareTabverse.test.ts` (create request, incoming list,
  `loadSharedTabverse` → a new tabverse); `serverApi.test.ts`.
  `pnpm test`, `typecheck`, `lint:check`, `format:check`, `build`.

## 14. Work items, in order

1. **ADR 0028** - RBAC shares, live read, the per-user marker, editable deferred.
2. **Store** - central tables, `internal/store/shares.go`, per-user migration →
   2 and the mark API, `bundleToExport`, tests.
3. **API** - `self`, the seven routes, RBAC, the read path, openapi, tests.
4. **Console read** - `shareAdapter`, a **Shared with me** list, the read-only
   drawer for a share.
5. **Console write** - the drawer's Share panel (mode, include, grantees).
6. **Extension write** - `shareTabverse`, the Share dialog, the badge.
7. **Extension read** - `loadSharedTabverse`, the **Shared with me** list.
8. **Tie-offs** - audit entries; revoke a tabverse's share on `adr/0015` delete;
   the webstore listing and privacy policy; a real run in Chrome (pair two
   accounts, share, read from the second).

## 15. Files

| Path | What |
|---|---|
| `doc/tabverse-share-tabverse-plan.md` | this plan |
| `adr/0028-…` | the decision record |
| `server/internal/store/shares.go` | shares + grants + RBAC query |
| `server/internal/store/store.go` | the two central tables |
| `server/internal/store/userdb.go` | the per-user marker table (migration → 2) |
| `server/internal/store/export.go` | `bundleToExport` |
| `server/internal/api/shares.go` | handlers + `self` + RBAC |
| `server/internal/api/server.go` | routes |
| `api/openapi.yaml` | the share paths and schemas |
| `server/ui/data/{types,api}.ts` | the console client |
| `server/ui/data/shareAdapter.ts` | document → `TabspaceBundle` |
| `server/ui/views/tabverse/TabverseDrawer.tsx` | the Share panel |
| `src/data/repo/{types,serverApi}.ts` | the extension client |
| `src/data/repo/shareTabverse.ts` | share + incoming + load |
| `src/ui/manager/.../ShareTabverseDialog.tsx` | the extension share UI |
| `src/ui/popup/PopupView.tsx` | the "Shared with me" entry |

## 16. Toward collaboration (what editable re-opens)

Read-only shares are stage one. Editable shares are a change to *who owns a
tabverse*, and the parts below are why it is deferred, not why it is impossible.

- **Ownership boundary.** Content is per account (`adr/0027`). An editor writing
  to the owner's database makes that file multi-writer, which touches the pool
  cap, the FD budget (`internal/rlimit`) and the counter cache (`adr/0026`).
  Read-only needs none of that: it only reads.
- **Multi-writer sync.** The protocol is LWW per record on a **client clock**.
  Several writers need a server-side clock (`server_at`/HLC), and the aggregate
  rows (`tabIds`, `allnote`, `alltodo`, `allbookmark`) are whole lists in one row
  that concurrent editors would clobber - order should move to a per-row
  `position` before more than one writer holds the format.
- **Attribution.** A shared record wants an `actor` (`user_id`, not just
  `device_id`) so the UI can say who changed what.
- **Rich text.** Two people in one note is beyond LWW: a CRDT (a real
  dependency) or a coarser per-block/lock rule.
- **Realtime/presence.** `internal/hub` fans out per `user_id`; collaboration
  wants a topic per share, plus presence. Read-only needs only a
  `shares_changed` notice so a list redraws.
- **The unit is the saved tabverse, not the window.** A tabverse tracks one
  window's live tabs (`adr/0006`) with session-scoped ids, so "collaborate"
  means a shared *saved* workspace each person loads into their own window and
  saves back - which is exactly what the read-only path's `loadSharedTabverse`
  already does, one direction.

The guardrails worth keeping while stage one is cheap: keep the document an
interchange format (D7), keep `server_at` authoritative in the schema, and do
not add a new surface that keys off `user_id` in a way a future actor/space
could not slot into.
