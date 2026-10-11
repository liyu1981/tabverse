# Plan: Tabverse against Workona's feature list

Status: **analysis only** (2026-10). No code, no schema, no ADR yet: this is
the comparison and the order I would take the gaps in. Each gap that gets
picked up needs its own `doc/*-plan.md` (and an ADR where it changes the trust
model - cloud integrations and collaboration, per `adr/0002`).

Workona's list, as given, is eleven features. Against this repository: **four
are covered, three are partly covered, four are missing.** The cheap ones are
tab suspension, a tasks hub, task fields and templates; the expensive ones are
cloud-app integrations, collaboration and versioned backups, and two of those
three would reverse decisions this project made on purpose.

Effort units, used because a number of weeks would be false precision:

- **S** - one module and its tests, no wire change.
- **M** - a schema or wire change (Dexie + `api/openapi.yaml` + server + sync
  conversion + UI), or a new route/surface over existing data.
- **L** - multi-week: server semantics and/or a new permission model.
- **XL** - changes the product's trust model; wants its own ADR and permanent
  maintenance (third-party APIs, multi-user permissions).

## 1. Line by line

| Workona | Tabverse today | Verdict |
| --- | --- | --- |
| **Spaces** (project organisation) | tabverses: named, ordered, with tab groups and split views, saved and synced | **have** - no per-space icon or colour |
| **Tab manager** (autosave + cloud sync) | this *is* the core: Dexie + outbox + delta pull + WebSocket + LWW (`src/data/repo/`) | **have** |
| **Tab suspension** | we read `chrome.tabs.Tab.discarded` into `Tab.suspended` (`src/data/tabSpace/chromeTabFields.ts`) and never discard anything | **missing** |
| **Global / universal search** | bm25 FTS over our six entities when paired, substring scan offline, one box in the popup | **partial** - no browser history, no cloud apps |
| **Tasks and to-do lists** | per-tabverse `content` + `completed`, in the right panel | **partial** - no due date, description or attachments; no keyboard shortcut |
| **My Tasks hub** | none: a todo is only visible inside the tabverse that owns it | **missing** |
| **Resources section** | per-tabverse bookmarks and notes | **have-ish** - no dedicated panel, no link previews |
| **Cloud app integrations** | none. Google sign-in exists for the console's accounts only (`adr/0017`), which is not the same thing | **missing** |
| **Shared spaces and collaboration** | records are `user_id`-scoped; the console's read-only view of an account is operator-only (`adr/0014`) | **missing** |
| **Templates and automation** | none | **missing** |
| **Cloud backups / restore a session** | the server holds the latest copy of every record; closed-tab History per tabverse (999 cap, `adr/0007`); restore-into-window exists | **partial** - no point-in-time history |

## 2. What each gap costs

| Gap | Effort | Touches | The cost that is not code |
| --- | --- | --- | --- |
| **Tab suspension** | **M** | a policy module + a setting; `chrome.tabs.discard`; `idle` and `alarms` are already granted | Discarding loses in-page state on reload. The policy has to be conservative (idle window, skip active/audible/pinned/the manager tab, host allow-list) or it eats somebody's half-written document. No wire change: `suspended` is already a read of Chrome. |
| **My Tasks hub** | **S-M** | a cross-space todo query (local index, or one server route) + a manager route | The `Search` route and `OmniSearch` are already stubbed (`src/ui/manager/routes.ts`, `OmniSearch/OmniSearch.tsx`, `SidebarSearch` commented out), so the surface exists on paper. No schema change. |
| **Task fields + quick add** | **M + S** | `dueAt` / `description` / attached tab ids on the `todo` entity: Dexie, wire, `api/openapi.yaml`, server FTS body, UI; a `commands` entry for the shortcut | The schema half is the expensive half in this repository: one new field is four layers plus the console's read path. The shortcut is small but adds a new capture surface to design. |
| **Templates** | **M** | a flag on `tabspace` (schema + wire) or a local-only flag (cheaper, not synced) + "new from template" | "Automation" (rules) is not in this estimate; that is an **XL** on its own. |
| **Browser-history search** | **M** | the `history` permission, `chrome.history.search`, merging results into the existing search | Cost is trust, not code: we would start reading all browsing history rather than only the tabs we saved. Wants an ADR and a privacy-policy change, and the permission prompt costs installs. |
| **Cloud app integrations** | **XL** | OAuth per provider, token storage, API clients, previews, sync of external documents | Direct conflict with `adr/0002` ("no third parties"). Turns the project into a connector platform, with API maintenance forever. |
| **Shared spaces, read-only link** | **M-L** | a share token + routing; reuses the console's read-only tabverse drawer (`adr/0019`) | A share link is a credential: expiry, revocation, and the fact that it exposes a whole tabverse's browsing data to whoever holds the URL. |
| **Full collaboration** | **XL** | ownership to ACL, membership, invitations, concurrent editing, presence | Every table is `user_id`-scoped, the FTS index is per user, `rev_seq` is per user, and `adr/0006`'s "the tabverse is the window" plus the ordering aggregates assume one writer. This is a different product, not a feature. |
| **Cloud backups, versioned** | **L** | append-per-accepted-push on the server, a retention policy, a restore UI | `rev` is LWW bookkeeping, not a version chain (`server/internal/store/store.go`: one `records` row per entity id). The cheap 80% is user-facing **export/import** (**S**) plus today's closed-tab History. |

## 3. Order I would take them in

1. **Tab suspension** (M). Biggest daily win, no wire change, permissions already
   granted, and it is the one Workona feature this extension visibly lacks.
2. **Tasks**: the hub over existing todos (S-M) first, then the fields (M). The
   hub is what makes the list worth filling in, and it needs no schema change;
   the fields are what make it worth using, and they do.
3. **Templates** (M) and **export/import** (S). Templates are the "recurring
   project" win; export is the honest version of "backup" that does not grow the
   server's storage story.
4. **Browser-history search** (M) - only with an ADR. It is a privacy decision.
5. **Cloud integrations** and **collaboration** (**XL**): not before a plan and
   an ADR each. If either is wanted, the read-only share link (M-L) is the first
   slice of collaboration worth building.

## 4. What this project has that Workona's list does not

Worth keeping in view before copying features across:

- A **self-hostable sync server**: one static Go binary, accounts, devices,
  tokens, a multi-tenant admin console, and (since `adr/0024`) a documentation
  site on the same origin.
- **The console reuses the extension's read-only tabverse view** (`adr/0019`),
  so an operator's view and a saved view cannot drift.
- **Split views and tab groups as saved layout** (`adr/0022`), not as a live
  browser state the record forgets.
- **A local tab-preview cache** that never leaves the machine (`adr/0016`).
- **On-device AI naming** (Chrome's built-in model): nothing sent anywhere, and
  now a settings section that says whether the device has it.
- **Merge-on-load restore**: loading a tabverse into a window keeps what is
  there and adds what is missing, instead of replacing the window.

## 5. How the claims above were checked

Read, not assumed (this is the evidence for the "have / partial / missing"
column):

- No `chrome.tabs.discard` anywhere in `src/`; `suspended` is only read, in
  `src/data/tabSpace/chromeTabFields.ts` (`draft.suspended = chromeTab.discarded`).
- `src/data/todo/Todo.ts`: `Todo` is `{ tabSpaceId, content, completed }`, and
  nothing else.
- `src/data/search/searchable.ts`: the searchable types are `tabspace`, `tab`,
  `note`, `todo`, `bookmark`, `closedtab` - no browser history, no third party.
- `src/manifest.json`: permissions are `tabs`, `tabGroups`, `storage`,
  `unlimitedStorage`, `activeTab`, `idle`, `alarms` - no `history`, and no
  `commands` key (so no global shortcut today).
- `server/internal/store/store.go`: the tables are `users`, `devices`, `tokens`,
  `invites`, `records`, `identities`, `email_tokens`, `verif_tokens`,
  `retired_subjects`, `audit_log`, `server_secrets`, `records_fts` - one current
  row per record, and no versions table.
- `adr/0002` (no third parties, opt-in sync), `adr/0006` (window ownership;
  session snapshots removed), `adr/0008` (two search backends),
  `adr/0014`/`adr/0015` (console is an account, admin delete),
  `adr/0019` (the shared read-only view), `adr/0022` (split views),
  `adr/0024` (site and console on one origin).

The effort units are my judgement, not a measurement; the sequencing in §3 is
the part of this document worth arguing with.
