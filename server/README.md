# tabversed — the Tabverse sync server

Single-binary Go server that replaces the extension's client side coordination
(leader election, broadcast-channel, dexie-observable, Dropbox dumps) with a
server authoritative sync protocol.

- **Storage:** SQLite (pure Go driver, no cgo → cross-compiles everywhere)
- **Sync:** per-user monotonic revisions, delta pull + batch push, LWW conflicts
- **Realtime:** one WebSocket per device, `records_changed` fan-out
- **Search:** FTS5 (replaces ~760 LOC of client side indexing)
- **Retention:** server side pruning of records by age. It only ever pruned
  `session` (browser window/tab snapshots); the extension no longer records
  those (ADR 0006), so this now exists for older clients and can go with the
  entity

## Run

Every build/run/cross-compile target is an npm script at the repository root
(`package.json` is the only build tool; there is no Makefile).

```sh
pnpm run server:dev      # go run: listens on 0.0.0.0:8223, db ./server/data/tabversed.db
pnpm run server:build    # binary at server/bin/tabversed
# or
pnpm run server:docker && docker run -p 8223:8223 -v tvdata:/data tabversed
```

The default bind address is `0.0.0.0` on purpose: during development the
extension is usually loaded on a different machine than the server. The server
logs a warning when it listens on a non-loopback address, because the
bootstrap/pairing endpoint is then reachable from the network and whoever pairs
first owns the deployment (ADR 0002). Set `TABVERSED_ADDR=127.0.0.1:8223` to
keep it local.

Cross compile (no cgo):

```sh
pnpm run server:cross    # linux/amd64, linux/arm64, darwin/amd64, darwin/arm64, windows/amd64
```

Tests and checks:

```sh
pnpm run server:test        # go test ./...
pnpm run server:test-race   # go test -race ./...
pnpm run server:vet         # go vet ./...
pnpm run server:fmt         # gofmt -l -w .
pnpm run server:fmt:check   # lists unformatted files (CI asserts the list is empty)
```

## Configuration (environment)

| Variable                     | Default             | Meaning                                                     |
| ---------------------------- | ------------------- | ----------------------------------------------------------- |
| `TABVERSED_ADDR`             | `0.0.0.0:8223`      | listen address (use `127.0.0.1:8223` to stay local)         |
| `TABVERSED_DB`               | `data/tabversed.db` | SQLite file path                                            |
| `TABVERSED_RETENTION_DAYS`   | `14`                | prune `session` records older than this (0 = keep forever)  |
| `TABVERSED_MAX_RECORD_BYTES` | `1048576`           | max payload size per record                                 |
| `TABVERSED_SYNC_BATCH_LIMIT` | `500`               | max records per sync request                                |
| `TABVERSED_SEARCH_LIMIT`     | `50`                | max search hits                                             |
| `TABVERSED_WS_ORIGINS`       | _(any)_             | comma separated Origin allow list for the WebSocket upgrade |

## API

See [`../api/openapi.yaml`](../api/openapi.yaml). Quick tour:

```sh
# 1. create the account (only allowed while the server has no users)
curl -s -X POST localhost:8223/api/v1/auth/bootstrap -d '{"name":"yli"}'
# -> {"user_id":"usr_...","device_id":"dev_...","token":"..."}

# 2. upload data
curl -s -X POST localhost:8223/api/v1/sync \
  -H 'Authorization: Bearer <token>' \
  -d '{"records":[{"entity":"note","id":"n1","updated_at":1760000000000,
       "payload":"{\"title\":\"hello\"}"}]}'

# 3. download everything changed since revision 0
curl -s 'localhost:8223/api/v1/sync?since=0' -H 'Authorization: Bearer <token>'

# 4. search
curl -s 'localhost:8223/api/v1/search?q=hello' -H 'Authorization: Bearer <token>'

# 5. pair another device: mint a code on device A, redeem it on device B
curl -s -X POST localhost:8223/api/v1/auth/invites -H 'Authorization: Bearer <token>' -d '{"ttl_seconds":300}'
curl -s -X POST localhost:8223/api/v1/auth/pair -d '{"invite_code":"XXXX-XXXX-XXXX-XXXX","device_name":"laptop"}'
```

Realtime: `ws://host/api/v1/sync/stream?access_token=<token>` receives

```json
{"type":"hello","rev":12,"server_at":1760000000000}
{"type":"records_changed","rev":13,"entities":["note"],"server_at":1760000000001}
```

## Protocol semantics

- **Revisions** — every accepted write bumps `users.rev_seq`; the record stores
  the new value in `rev`. Clients track their last seen revision and pull
  `rev > since`.
- **Conflicts** — last-writer-wins on the client supplied `updated_at`
  (unix ms). A losing write returns `status:"stale"` together with the server's
  `current` copy so the client can merge locally.
- **Idempotency** — replaying an identical record does not consume a revision,
  so clients can retry a push whose response was lost.
- **Deletes** — tombstones (`deleted:true`, empty payload), propagated through
  the same delta channel; no special case for clients.
- **Security** — tokens are 32 bytes of CSPRNG entropy stored as SHA-256
  hashes; pairing codes are single use with a TTL; the bootstrap endpoint
  permanently locks itself after the first account exists.
