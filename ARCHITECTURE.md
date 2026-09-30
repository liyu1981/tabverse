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
| `server/`            | **new** `tabversed` sync server (pure Go, no cgo)                                                        |
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

## Commands

```sh
npm run develop      # vite build --watch (development, includes dev pages)
npm run build        # production bundle in dist/
npm test             # vitest + coverage
npm run typecheck    # tsc --noEmit
npm run lint:check   # eslint 10 (flat config in eslint.config.mjs)
npm run format:check # biome 2
npm run build-crx    # production bundle + dist_crx/tabverse.zip (store package)
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

The server has no Makefile: every build, test and cross-compile target is an
npm script (`server:dev`, `server:build`, `server:test`, `server:vet`,
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
browser ── GET / ───┤                        └─ read only: tabverses, records, search
```

- **unset** (the default) — single tenant, open bootstrap until the first pairer,
  every admin route `404`
- **set** — the console at `/` provisions accounts, hands out pairing codes,
  revokes leaked devices, and shows what each account stored, **read only**:
  there is no endpoint that edits a user's records, because a record written
  outside the extension would lose the next LWW comparison anyway

`internal/webui` embeds three hand written files (HTML, CSS, JS - no framework,
no build step) and serves them with a strict CSP; the admin API is
`internal/api/admin.go` and its queries are `internal/store/admin.go`. A device
token and the admin token are not interchangeable, and both directions are
tested.

## Status

- [x] Go server (`tabversed`): auth, delta sync, LWW, tombstones, WebSocket
      fan-out, FTS5 search, retention, tests (`-race`), cross-compile, Docker
- [x] Multi tenant admin API + embedded read only console (`adr/0009`)
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
- [x] Cross-window machinery deleted: each manager page owns one window, so
      the tabSpaceRegistry (leader election + broadcast-channel) is gone and
      the change feed uses Dexie's own write hooks instead of dexie-observable
      (`adr/0006`)
- [ ] A real run in Chrome: load `dist/` unpacked, pair a server, exercise
      capture -> sync -> search and the note editor
