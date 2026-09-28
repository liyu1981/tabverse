# Tabverse architecture (after the server pivot)

```
┌─ Chrome extension (MV3) ────────────────┐      ┌─ tabversed (Go) ──────────────┐
│ popup / manager pages (React)           │      │ cmd/tabversed                 │
│  ├─ ui/                                 │ REST │  internal/api    HTTP routes   │
│  ├─ data/  domain stores (effector)     │◄────►│  internal/sync   delta + LWW   │
│  └─ data/repo/  ★ sync layer            │      │  internal/hub    WebSocket     │
│ background service worker               │  WS  │  internal/store  SQLite+FTS5   │
│  ├─ background.ts  (tab events, search) │◄────►│  internal/auth   pairing       │
│  └─ repo/backgroundSync (sync runtime)  │      │  internal/retention (sessions) │
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

`tabspace`, `tab`, `session`, `note`, `todo`, `bookmark` plus the three
per-tabspace ordered aggregates `allnote`, `alltodo`, `allbookmark` (they
carry the display ordering, which cannot be rebuilt from entity rows).

## Commands

```sh
npm run develop      # vite build --watch (development, includes dev pages)
npm run build        # production bundle in dist/
npm test             # vitest + coverage
npm run typecheck    # tsc --noEmit
npm run lint:check   # eslint 10 (flat config in eslint.config.mjs)
npm run format:check # prettier 3
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

The server has no Makefile: every build, test and cross-compile target is an
npm script (`server:dev`, `server:build`, `server:test`, `server:vet`,
`server:fmt`, `server:cross`, `server:docker`). It binds `0.0.0.0:8223` by
default so the extension can be loaded on another machine; set
`TABVERSED_ADDR=127.0.0.1:8223` to keep it local.

See `server/README.md` for configuration, deployment and protocol semantics.

## Status

- [x] Go server (`tabversed`): auth, delta sync, LWW, tombstones, WebSocket
      fan-out, FTS5 search, retention, tests (`-race`), cross-compile, Docker
- [x] Wire contract (`api/openapi.yaml`)
- [x] Client sync layer: outbox, delta engine, realtime, Dexie bridge,
      change feed, pairing dialog (8 test suites)
- [x] MV3 hardening: `storage` permission, tightened CSP,
      `minimum_chrome_version`, `action.default_icon`, module service worker
- [x] Toolchain revamp — Vite 8, React 19, Blueprint 6, Vitest 5, ESLint 10
      flat config, Prettier 3, TypeScript 5.9 (`adr/0003`, `adr/0004`)
- [x] draft-js -> TipTap with a tested legacy content converter
- [x] TypeScript strict **subset** enabled (see the comments in
      `tsconfig.json`); dead stores cleaned, ESLint's `no-useless-assignment`
      stays on
- [x] CI: typecheck, format, lint, tests, prod build, store zip + Go
      vet/race/cross-compile
- [x] Store disclosure notes (`doc/chrome-webstore/listing.md`) and the
      privacy policy's "Optional server sync" section
- [ ] Existing users' local data upload is a **manual, explicit** button
      (see ADR 0002 §3) — no silent migration
- [ ] `strictNullChecks` (428 errors) + `noImplicitAny` (227) — staged pass,
      count first with `npx tsc --noEmit --strict`
- [x] Cross-window machinery deleted: each manager page owns one window, so
      the tabSpaceRegistry (leader election + broadcast-channel) is gone and
      the change feed uses Dexie's own write hooks instead of dexie-observable
      (`adr/0006`)
- [ ] A real run in Chrome: load `dist/` unpacked, pair a server, exercise
      capture -> sync -> search and the note editor
