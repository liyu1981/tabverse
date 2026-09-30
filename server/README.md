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
- **Entities:** `tabspace`, `tab`, `note`, `todo`, `bookmark`, `closedtab`
  (the History tool: tabs closed in a tabverse, ADR 0007) plus the client's
  ordered aggregates `allnote`, `alltodo`, `allbookmark`. Only the first group
  is in the FTS index; the aggregates are id lists. Every hit comes back with
  the `tabspace_id` it belongs to, because the client lists tabverses (ADR
  0008), and identifier fields are not indexed at all
- **Accounts:** one account per deployment by default (open bootstrap, first
  pairer wins). Set `TABVERSED_ADMIN_TOKEN` and an operator provisions any
  number of accounts through the admin API instead (ADR 0009)
- **Console:** `GET /` serves an embedded, dependency free operator console
  (read only over user data: tabverses, records, search; mutable: accounts,
  devices, tokens). Same env var, same secret, no build step

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
keep it local, or set `TABVERSED_ADMIN_TOKEN` to take the pairing endpoint
behind a secret and to be able to run more than one account (ADR 0009).

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
| `TABVERSED_ADMIN_TOKEN`      | _(unset)_           | enables the admin API and the console; without it the deployment is single tenant (ADR 0009) |
| `TABVERSED_DEVICE_INACTIVE_DAYS` | `30`           | silence required before a device may be archived (ADR 0011); a device that never authenticated is exempt, `0` disables the check |

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

## Multi tenancy and the console (ADR 0009)

By default the server is single tenant: `/api/v1/auth/bootstrap` is open only
while the database holds no account, and that account owns the deployment
afterwards. Every tenant scoped table already carried `user_id`, so making a
second account possible was a matter of letting an operator create one.

```sh
TABVERSED_ADMIN_TOKEN=$(openssl rand -base32 24) pnpm run server:dev
# then open http://localhost:8223/ and paste the token
```

With the token set:

- **multi tenant** — `POST /api/v1/admin/users` creates accounts, each isolated
  by `user_id` exactly as the devices of one account already were, and
  `/api/v1/auth/bootstrap` now requires the admin token too (no more
  first-payer-wins on an exposed port)
- **read only data browser** — the console lists an account's tabverses, opens
  one the way the extension does (tabs in `tabIds` order, notes/todos/bookmarks
  in their aggregate order, closed tabs newest first), plus a raw record
  browser and the same FTS search the extension uses

The account view is three tabs, rail on the left, panel on the right: **Pair
Code** (mint a code, copy it and the server URL), **Devices & Tokens** (revoke,
archive, inspect) and **Stored data** (tabverses, search, records). Each tab
carries its own counters in the rail, so an operator can see what is behind one
without opening it, and the first visit on an account with no devices lands on
Pair Code. `#token=…&user=…&tab=credentials` opens a specific tab directly.
- **accounts and tokens** — rename, delete (records, devices, tokens, invites
  and search index rows), mint a pairing code for a given account, revoke one
  token by fingerprint or every token of one device

There is deliberately **no way to edit a user's records from the console**: a
record written there would carry no device and no trustworthy client clock, so
the next honest sync from the real device would win the LWW comparison. The
admin surface is for operator state; the data stays the extension's to write.

The console is three embedded files under `internal/webui/assets/` (HTML, CSS,
JS - no framework, no build step) served with a strict CSP. It keeps the admin
token in `localStorage`, so treat that browser profile like the token itself.
Without `TABVERSED_ADMIN_TOKEN` the routes answer `404` and the login screen
explains that the deployment is single tenant.

The pairing code and the server URL next to it each get a copy button. Copying
falls back through three steps on purpose, because a self-hosted console is
usually opened over plain `http://` on a LAN, which is *not* a secure context:
`navigator.clipboard` does not exist there, so the button uses it only when it
is available, then `execCommand('copy')`, and as a last resort selects the text
and says "press Ctrl+C" instead of silently doing nothing.

```sh
# what the console does, by hand
A='Authorization: Bearer $TABVERSED_ADMIN_TOKEN'
curl -s localhost:8223/api/v1/admin/users -H "$A"
curl -s -X POST localhost:8223/api/v1/admin/users -H "$A" -d '{"name":"alice"}'
curl -s -X POST localhost:8223/api/v1/admin/users/usr_.../invites -H "$A" -d '{"ttl_seconds":300}'
curl -s 'localhost:8223/api/v1/admin/users/usr_.../tabspaces' -H "$A"
curl -s 'localhost:8223/api/v1/admin/users/usr_.../tabspaces/ts_...' -H "$A"
curl -s 'localhost:8223/api/v1/admin/users/usr_.../search?q=hello' -H "$A"
curl -s -X DELETE localhost:8223/api/v1/admin/users/usr_.../devices/dev_... -H "$A"

# then retire the dead device (revoked + silent), and what it last wrote
curl -s -X PUT localhost:8223/api/v1/admin/users/usr_.../devices/dev_.../archive -H "$A"
curl -s -X PUT localhost:8223/api/v1/admin/users/usr_.../devices/dev_.../records/archive -H "$A"
curl -s 'localhost:8223/api/v1/admin/users/usr_...?archived=1' -H "$A"   # show archived
```

### Archiving (ADR 0011)

Archiving is how a dead credential is tidied away, and it is deliberately
**not** a delete: `archived_at` hides a row from this console's default views,
while the record stays stored and keeps syncing to the user's own devices, and
the extension's search is not filtered either. Reversible, and the user's data
is never at risk - to remove data, delete the account.

| Step | Endpoint | Precondition |
| ---- | -------- | ------------ |
| Archive a token | `PUT .../tokens/{hash}/archive` | the token must be revoked |
| Archive a device | `PUT .../devices/{id}/archive` | no usable token left, **and** silent for `TABVERSED_DEVICE_INACTIVE_DAYS` (a device that never authenticated is exempt) |
| Archive what it wrote | `PUT .../devices/{id}/records/archive` | the same two rules |
| Undo any of the above | `DELETE` the same paths | - |

Unarchiving never re-enables access: a revoked token stays revoked. A record
that is edited again un-archives itself, because it is live again; tombstones
are not restored.
