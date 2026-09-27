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

| Module              | Responsibility                                                                                       | Test                     |
| ------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------ |
| `types.ts`          | wire types mirrored from `api/openapi.yaml`                                                          | –                        |
| `serverApi.ts`      | typed fetch client, error normalization (401 = re-pair)                                              | `serverApi.test.ts`      |
| `outbox.ts`         | durable mutation queue in `chrome.storage.local`, collapses per record to newest edit                | `outbox.test.ts`         |
| `repo.ts`           | `SyncEngine`: flush outbox → pull delta → persist cursor; LWW conflict hooks; `ChromeSyncStateStore` | `repo.test.ts`           |
| `realtime.ts`       | WebSocket with injectable scheduler/backoff                                                          | `realtime.test.ts`       |
| `dbBridge.ts`       | entity ↔ Dexie table mapping, `listLocalRecords` / `applyServerRecords`                              | `dbBridge.test.ts`       |
| `changeFeed.ts`     | Dexie `changes` hook → outbox (creates, updates, deletes); suppresses pull→push echo                 | `changeFeed.test.ts`     |
| `syncConfig.ts`     | pairing + config persistence                                                                         | `syncConfig.test.ts`     |
| `backgroundSync.ts` | wires all of the above for the service worker                                                        | `backgroundSync.test.ts` |

### Data flow

```
local edit  ──Dexie hook──► outbox ──flush──► POST /sync (LWW push)
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
cd server && make run          # :8080, ./data/tabversed.db
curl -X POST localhost:8080/api/v1/auth/bootstrap -d '{"name":"me"}'
# on the extension: BottomNav -> sync button -> paste URL + pairing code
curl -X POST localhost:8080/api/v1/auth/invites \
     -H 'Authorization: Bearer <token>' -d '{"ttl_seconds":300}'
```

See `server/README.md` for configuration, deployment and protocol semantics.

## Status

- [x] Go server: auth, delta sync, LWW, tombstones, WebSocket fan-out,
      FTS5 search, retention, tests, cross-compile, Docker
- [x] Wire contract (`api/openapi.yaml`)
- [x] Client sync layer with 61 unit tests
- [x] Integration: change feed + background runtime + pairing dialog
- [x] MV3 hardening: `storage` permission, tightened CSP,
      `minimum_chrome_version`, `action.default_icon`
- [x] CI: format, lint, tests, prod build, Go vet/race/cross, store zip
- [ ] Existing users' local data upload is a **manual, explicit** button
      (see ADR 0002 §3) — no silent migration
- [ ] Toolchain revamp (webpack → Vite/WXT, React 18, TS 5 strict, ESLint 9
      flat config, Jest → Vitest) — deliberately _after_ the sync layer, see
      `adr/0001` follow-ups
- [ ] Store disclosures / privacy policy text (blocked on ADR 0002 wording)
