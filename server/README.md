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
- **Accounts:** people sign in to the console with a single-use email link (or a
  configured social provider) and manage their own account; the first
  registration with `TABVERSED_ADMIN_EMAIL` is the operator. There is no master
  credential (ADR 0012, ADR 0013)
- **Console:** `GET /console` serves the console: a read only browser over stored
  data, plus a way to delete one tabverse, and the account, device and token
  management around it. It is a Vite/React app under `server/ui`, built into
  `internal/webui/dist` and embedded in the binary (ADR 0018)
- **API:** everything the app calls is under the same prefix -
  `/console/api/v1/*` (sync, entities, search, admin, console), the sign-in
  routes under `/auth/*`, the probe at `/healthz`. An endpoint nobody claimed
  is a JSON `404`, never a page (ADR 0024)
- **Site:** `GET /` and anything else is the documentation when the binary was
  built with `officialserver=1`, and a page that sends you to `/console`
  otherwise. The flag is read at build time only - by `tools/embedsite.sh` and
  by the Docusaurus config - so Go embeds whatever is there and needs no flag
  of its own (ADR 0024)

## Run

Every build/run/cross-compile target is a package.json script at the repository root
(`package.json` is the only build tool; there is no Makefile).

```sh
pnpm run ui:build        # the console -> server/internal/webui/dist (embedded, not committed)
pnpm run site:prepare    # what lives at / : nothing by default (the redirect page is tracked)
                         #   officialserver=1 -> the docs -> server/internal/webui/docs
pnpm run server:dev      # go run: listens on 0.0.0.0:8223, db ./server/data/tabversed.db
pnpm run server:build    # builds the console, then the binary at server/bin/tabversed
# or
pnpm run server:docker && docker run -p 8223:8223 -v tvdata:/data tabversed
```

### Two flavours (`officialserver=1`)

The same code serves two kinds of deployment, and the difference is what was
embedded at the root (ADR 0024):

```sh
pnpm run server:build                        # self hosted: / redirects to /console
officialserver=1 pnpm run server:build       # official:   / is the documentation
```

The flag is read in exactly two places: `tools/embedsite.sh`, which builds the
Docusaurus site into `server/internal/webui/docs/` (and clears that directory
first, so a default build after an official one cannot ship it by accident), and
doc/tabverse-website's `docusaurus.config.js`, which switches `baseUrl` and `url`
and puts **Login** in the navbar after *User Manual*. The script also installs
the website's own dependencies first - it is a separate workspace with its own
lockfile, so nothing the repository's install does reaches it - which is why a
machine that has never built the docs can run the command as-is. The absolute addresses the
docs emit (canonical, sitemap) come from `TABVERSED_PUBLIC_URL` when it is set,
and default to `https://tabversed.liyu1981.xyz`.
`tools/builddoc.sh` (the GitHub Pages build) unsets the flag.

Every Go target runs `pnpm run site:prepare` before compiling, and CI builds and
tests both flavours - the official one in its own job, because nothing else
builds it.

The console's build output is **generated, not committed** (ADR 0018): every Go
target runs `pnpm run ui:build` first, so a binary and its console are one
build. A binary built without it (`cd server && go build ./...` on a fresh
clone) still compiles - a tracked `.gitkeep` keeps the embed directory present -
and serves a page naming the command to run.

To work on the console itself, run the app and the server side by side; the dev
server proxies `/console/api` and `/auth` to a `tabversed` on 127.0.0.1:8223:

```sh
pnpm run server:dev      # in one shell
pnpm run ui:dev          # in another: http://localhost:5174/console/
```

### The command line

With **no arguments the binary prints its help and exits** - it never starts by
accident, which matters for something meant to run for months.

```sh
tabversed                # the help
tabversed serve          # the server, in the foreground (what the binary used to do)
tabversed version        # "tabversed v1.2.3 (linux/amd64, go1.27)"
tabversed config         # write a .env here, from the embedded template (0600, --force to replace)
tabversed service install|status|start|restart|stop|logs
```

`service` is a **systemd user** unit (`systemctl --user`, no root, no sudo):
`install` writes `~/.config/systemd/user/tabversed.service`, reloads and enables
it, and stops there so starting stays a visible separate step. The unit runs
**`~/.local/bin/tabversed serve`** - a stable path, so replacing that file is the
upgrade and nothing has to be re-installed (`--bin` points it elsewhere) - with
its working directory at **`~/.tabversed`**, which is where the server reads
`.env` from (the binary reads it itself, so the file format has one parser
rather than two) and where the database lands by default -
`~/.tabversed/data/tabversed.db`, unless `TABVERSED_DB` says otherwise
(`--dir` moves both). A server meant to run for months should not depend on the
directory somebody was standing in when they installed it. `install` refuses to
point `ExecStart` at a path with no binary on it, because systemd's own answer to
that is a bare "No such file or directory". For a server that should survive a
logout, `loginctl enable-linger $USER` once.

`service logs` follows the journal and passes anything after it to `journalctl`
(`tabversed service logs --since -1h`).

A full local install, start to finish:

```sh
install -Dm755 <built binary> ~/.local/bin/tabversed
tabversed config --dir ~/.tabversed   # settings where the service will look
tabversed service install
loginctl enable-linger $USER         # optional: keep it running when logged out
tabversed service start
tabversed service logs
```

The default bind address is `0.0.0.0` on purpose: during development the
extension is usually loaded on a different machine than the server. The server
logs a warning when it listens on a non-loopback address, because the
bootstrap/pairing endpoint is then reachable from the network (ADR 0002). It is
open only until this deployment has a user or an account, so the window is
short; set `TABVERSED_ADDR=127.0.0.1:8223` to keep it local.

Cross compile (no cgo):

```sh
pnpm run server:cross    # linux/amd64, linux/arm64, darwin/amd64, darwin/arm64, windows/amd64
```

Tests and checks:

```sh
pnpm run server:test        # builds the console, then go test ./...
pnpm run server:test-race   # builds the console, then go test -race ./...
pnpm run server:vet         # builds the console, then go vet ./...
pnpm run server:fmt         # gofmt -l -w .
pnpm run server:fmt:check   # lists unformatted files (CI asserts the list is empty)
```

The console's own tests are in the root suite (`pnpm test`): vitest over its
data layer with a stubbed `fetch`, and `react-dom/server` over the views'
markup. There are no DOM tests - this repository does not install jsdom - so
what a view does when it is *clicked* is the user's to check, not the suite's.

## Configuration (environment, or a `.env` file)

Settings are read from the process environment. They may also live in a `.env`
file next to the binary: the server reads it at startup, **and the environment
still wins** over it, so systemd's `EnvironmentFile`, `docker run --env-file`
and `VAR=x ./tabversed` all keep overriding it. `TABVERSED_ENV_FILE` names a
different file, and a path given that way which cannot be read is a startup
error rather than a silent fallback to defaults. The format is `KEY=VALUE`
lines with `#` comments (no interpolation, no inline comments); a line that is
not a setting stops the server with its line number.

[`server/.env.example`](.env.example) is a filled-in template with the same
table and a start-to-finish production checklist. Copy it to `.env` - which is
git-ignored, because it holds the auth secret and the provider secret - and
`chmod 600` it.

| Variable                     | Default             | Meaning                                                     |
| ---------------------------- | ------------------- | ----------------------------------------------------------- |
| `TABVERSED_ADDR`             | `0.0.0.0:8223`      | listen address (use `127.0.0.1:8223` to stay local)         |
| `TABVERSED_DB`               | `data/tabversed.db` | SQLite file path                                            |
| `TABVERSED_RETENTION_DAYS`   | `14`                | prune `session` records older than this (0 = keep forever)  |
| `TABVERSED_MAX_RECORD_BYTES` | `1048576`           | max payload size per record                                 |
| `TABVERSED_SYNC_BATCH_LIMIT` | `500`               | max records per sync request                                |
| `TABVERSED_SEARCH_LIMIT`     | `50`                | max search hits                                             |
| `TABVERSED_WS_ORIGINS`       | _(any)_             | comma separated Origin allow list for the WebSocket upgrade |
| `TABVERSED_ADMIN_EMAIL`      | _(unset)_           | whose first registration becomes the operator (ADR 0013) |
| `TABVERSED_SESSION_TTL`      | `24h`                | how long one console sign-in lasts; `0` = no bound (ADR 0021) |
| `TABVERSED_SESSION_COOKIE_TTL` | _(same as the session)_ | how long the browser keeps the cookie; defaults to `TABVERSED_SESSION_TTL` so the credential never outlives the session |
| `TABVERSED_REQUIRE_HTTPS`    | `false`              | refuse to start when the console is served over plain http on a non-loopback `TABVERSED_PUBLIC_URL` (ADR 0021); off by default so a LAN deployment is not broken |
| `TABVERSED_ENV_FILE`       | _(unset)_           | read this file instead of `./.env`; unreadable is a startup error |

## API

See [`../api/openapi.yaml`](../api/openapi.yaml). Quick tour:

```sh
# 1. create the account (only allowed while the server has no users)
curl -s -X POST localhost:8223/console/api/v1/auth/bootstrap -d '{"name":"yli"}'
# -> {"user_id":"usr_...","device_id":"dev_...","token":"..."}

# 2. upload data
curl -s -X POST localhost:8223/console/api/v1/sync \
  -H 'Authorization: Bearer <token>' \
  -d '{"records":[{"entity":"note","id":"n1","updated_at":1760000000000,
       "payload":"{\"title\":\"hello\"}"}]}'

# 3. download everything changed since revision 0
curl -s 'localhost:8223/console/api/v1/sync?since=0' -H 'Authorization: Bearer <token>'

# 4. search
curl -s 'localhost:8223/console/api/v1/search?q=hello' -H 'Authorization: Bearer <token>'

# 5. pair another device: mint a code on device A, redeem it on device B
curl -s -X POST localhost:8223/console/api/v1/auth/invites -H 'Authorization: Bearer <token>' -d '{"ttl_seconds":300}'
curl -s -X POST localhost:8223/console/api/v1/auth/pair -d '{"invite_code":"XXXX-XXXX-XXXX-XXXX","device_name":"laptop"}'

# 6. or pair from the console's own session instead - the wizard (adr/0020).
#    The extension opens `/console?pair=1`, the person signs in there, and the
#    page calls this with their session cookie + XSRF header:
#      POST /console/api/v1/console/pair  {"device_name":"chrome","extension_id":"<id>"}
#    -> {"user_id":"usr_...","device_id":"dev_...","token":"..."}
#    No invite code, no account parameter: the account is the session's.
```

Realtime: `ws://host/console/api/v1/sync/stream?access_token=<token>` receives

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

## Accounts (ADR 0012, ADR 0013)

The extension keeps pairing with a device token; the **console signs in with an
account**. There is no master credential: every console route needs a session,
and the only secret involved is the one that signs it.

```sh
TABVERSED_ADMIN_EMAIL=you@example.com \
TABVERSED_PUBLIC_URL=https://tabs.example.com \
TABVERSED_SMTP_HOST=smtp.example.com TABVERSED_SMTP_FROM=tabs@example.com \
  pnpm run server:dev
# open /, enter that address, follow the link it sends
```

### Becoming the operator

The first account registered with `TABVERSED_ADMIN_EMAIL` **is** the operator -
no token, no code, nothing to copy out of a log. Everything else follows from
there: an operator promotes other people from the account page, and the last
operator cannot be demoted or disabled.

- If the variable is **unset**, nobody is an operator until you set it and
  restart; the server says so in the log, and a signed-in person who matches it
  is told in the console that a restart is what is missing.
- If the address **already has an account** when you set the variable, the next
  start promotes it. That is the upgrade path for a deployment that was
  registered before this rule existed.
- Once an operator exists the variable grants **nothing**, so leaving it set
  cannot become a stale privilege.
- **Lockout recovery** is the database, which is the honest answer for a
  self-hosted server whose data is plaintext anyway (ADR 0002):
  `sqlite3 tabversed.db "UPDATE users SET role='admin' WHERE email='<you>'"`.
  There is deliberately no backdoor that works without it.

### What you see

Everybody lands on **their own account** with the three tabs - Pair Code,
Devices & Tokens, Stored data. An operator gets a **fourth tab, "Admin"** (ADR
0014): the accounts, with *Impersonate*, *Make/Remove operator* and *Delete*
per row.

*Impersonate* switches the three account tabs to that account, read-only, titled
`alice (impersonated by admin)`; the Admin tab stays put, so another account is
one click and coming back is *Stop looking*.

There is no "create account" anywhere: registration is the only way an account
comes into existence, so there is a single path that can prove an address. The
accounts sidebar is gone - it was a second copy of the directory for an operator
and a single useless row for a person.

### Signing in

A single-use link sent to the address you type - there is no password anywhere,
so nothing to forget, reuse or leak. The link works once and expires in 30
minutes. With no `TABVERSED_SMTP_HOST` the link is printed to the server log,
which is what a LAN-only deployment wants. GitHub and Google are offered when
configured; a self hosted OpenID Connect provider is *not* wired (the auth
library's custom provider speaks plain OAuth2, not OIDC discovery with id_token
validation, and a button that half-works is worse than none).

**Pairing a browser out of that session** (`adr/0020`): the extension opens this
console at `/console?pair=1&ext=<its id>&nonce=<uuid>`, the person signs in with the
flow above and approves a device name, and the page calls
`POST /console/api/v1/console/pair` with the session. It mints a device and a token for
the signed-in account - the same thing `POST /console/api/v1/auth/pair` does for an
invite code, minus the code, because this person is the owner of the account
rather than holding a key to it - and the page hands the token to the extension
over `chrome.runtime.sendMessage`, which the manifest's `externally_connectable`
entry allows from this origin alone. The token is never rendered. There is no
account parameter (the account is the session's) and an impersonating session is
refused, since a token issued under one would outlive the impersonation.

**Google asks for the address, and that is the point** (`adr/0017`). The auth
library's own Google preset requests the profile scope only and never receives an
address - which this console cannot do without, because the address is the
account: it is what `TABVERSED_ADMIN_EMAIL` is matched against and what
`TABVERSED_LINK_BY_EMAIL` merges accounts by. So Google is registered as a custom
provider asking for `profile email`, and Google's `email_verified` marks the
account proven exactly as following an emailed link does. The redirect URI is
unchanged (`https://<your-host>/auth/google/callback`), and both scopes are basic
profile scopes, so no app verification is needed.

GitHub is the remaining gap, and it is a different shape of problem: the library's
preset returns no address at all, so a GitHub sign-in leaves the account unproven
and is refused unless `TABVERSED_REQUIRE_EMAIL_VERIFICATION=false`. Fixing it
properly needs GitHub's `/user/emails` lookup and a decision about which of a
person's addresses is the account's.

A person then manages their own account: mint pairing codes, list and revoke
their own devices, browse their own data. That is what removes the operator
from the critical path.

### Accounts on a server that predates them

A deployment can hold sync users created before accounts existed - by the old
bootstrap, or by pairing. The **first registration adopts a lone one**: the
account takes over that row, keeping its id, so every record already synced
stays attached instead of being orphaned on an account the console cannot show.
With several such users nothing is adopted - a wrong guess would hand one
person another person's browsing history - and the server says so in the log.

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `TABVERSED_ADMIN_EMAIL` | _(unset)_ | whose first registration becomes the operator |
| `TABVERSED_AUTH_SECRET` | generated once | signs session cookies; stored in the database if unset |
| `TABVERSED_PUBLIC_URL` | _(unset)_ | absolute base for sign-in links and social callbacks |
| `TABVERSED_SECURE_COOKIES` | `true` | turn off only for plain http on a trusted LAN |
| `TABVERSED_LINK_BY_EMAIL` | `true` | link a social login to an account with the same address; `0` refuses instead |
| `TABVERSED_REQUIRE_EMAIL_VERIFICATION` | `true` | refuse a session for an unproven address. A Google sign-in proves itself (ADR 0017) and the emailed link does; a GitHub sign-in does not, and needs this off |
| `TABVERSED_SMTP_HOST` / `_PORT` / `_USER` / `_PASS` / `_FROM` | _(none)_ | where sign-in links go |
| `TABVERSED_GITHUB_CLIENT_ID` / `_SECRET` | _(none)_ | enable the GitHub button |
| `TABVERSED_GOOGLE_CLIENT_ID` / `_SECRET` | _(none)_ | enable the Google button |
| `TABVERSED_DEV_MODE` | `false` | the auth library's fake OAuth provider, for local development |

**Upgrading from `TABVERSED_ADMIN_TOKEN`:** it is gone, and so is the token
screen in the console. Set `TABVERSED_ADMIN_EMAIL` to the address you use, start
the server, and register with it - the account that matches becomes the
operator. Anything the old token could reach, that account can reach. The
extension is unaffected: it pairs with a device token exactly as before.

## Multi tenancy and the console (ADR 0009)

By default the server is single tenant: `/console/api/v1/auth/bootstrap` is open only
while the database holds no account, and that account owns the deployment
afterwards. Every tenant scoped table already carried `user_id`, so making a
second account possible was a matter of letting an operator create one.

```sh
TABVERSED_ADMIN_EMAIL=you@example.com pnpm run server:dev
# then open http://localhost:8223/ and paste the token
```

With the token set:

- **multi tenant** — `POST /console/api/v1/admin/users` creates accounts, each isolated
  by `user_id` exactly as the devices of one account already were, and
  `/console/api/v1/auth/bootstrap` now requires the admin token too (no more
  first-payer-wins on an exposed port)
- **read only data browser** — the console lists an account's tabverses as rows,
  and clicking one slides in a drawer over the list with the same view the
  extension shows (name, when it was created and saved, "working on N tabs",
  the tab cards, tab groups), plus a raw record browser and the same FTS search
  the extension uses
- **delete a tabverse** — `DELETE /console/api/v1/admin/users/{id}/tabspaces/{tid}?confirm={tid}`
  tombstones that tabverse and every record hanging off it (tabs, notes, todos,
  bookmarks, closed tabs, ordering aggregates) and tells the account's devices,
  so their next sync removes their copy too (ADR 0015)

The account view is three tabs, rail on the left, panel on the right: **Pair
Code** (mint a code, copy it and the server URL), **Devices & Tokens** (revoke,
archive, inspect) and **Stored data** (tabverses, search, records). An operator
gets a fourth tab, **Admin**, which is the accounts themselves. Each tab carries
its own counters in the rail, so an operator can see what is behind one without
opening it, and the first visit on an account with no devices lands on Pair
Code. `#user=…&tab=credentials&tabspace=…` opens a specific account, tab and
tabverse directly (ADR 0014, ADR 0018).
- **accounts and tokens** — rename, delete (records, devices, tokens, invites
  and search index rows), mint a pairing code for a given account, revoke one
  token by fingerprint or every token of one device

There is deliberately **no way to edit a user's records from the console**: a
record written there would carry no device and no trustworthy client clock, so
the next honest sync from the real device would win the LWW comparison. The
admin surface is for operator state; the data stays the extension's to write.

**Deleting a tabverse is the exception, and it is a delete rather than an edit**
(`adr/0015`). It writes no content - it tombstones the tabverse and its records,
exactly as the extension's own `DELETE /console/api/v1/entities/{entity}/{id}` does,
because a delete has to travel the sync channel or the next push from any paired
device puts the rows back. It needs the tabverse id back as `?confirm=`, it is
refused while an operator is looking through somebody else's account, and it is
audited as `tabspace_deleted`. Archiving stays what ADR 0011 said it is:
bookkeeping that hides a row, not a delete that removes it.

The console is three embedded files under `internal/webui/assets/` (HTML, CSS,
JS - no framework, no build step) served with a strict CSP. It holds no secret
at all: the session is an httpOnly cookie, and the page only ever sees the XSRF
token it has to echo back. `console.css` is styled after the extension's own UI
(the palette in `src/global.scss`, the control shapes in `src/ui/theme.scss`),
so both look like the same product; because nothing imports those files into
the server, each token in it names the file it was taken from.

The pairing code and the server URL next to it each get a copy button. Copying
falls back through three steps on purpose, because a self-hosted console is
usually opened over plain `http://` on a LAN, which is *not* a secure context:
`navigator.clipboard` does not exist there, so the button uses it only when it
is available, then `execCommand('copy')`, and as a last resort selects the text
and says "press Ctrl+C" instead of silently doing nothing.

```sh
B=localhost:8223
J=cookies.txt     # a signed-in session, from the sign-in link

# who am I, and who runs this deployment
curl -s -b $J $B/console/api/v1/console/me

# what the console does for a person, by hand
curl -s -X POST "$B/console/api/v1/console/signin-link?user=me@example.com&address=me@example.com&site=$B"
U=usr_...
curl -s -b $J -X POST "$B/console/api/v1/admin/users/$U/invites?ttl_seconds=300"
curl -s -b $J "$B/console/api/v1/admin/users/$U/tabspaces"
curl -s -b $J "$B/console/api/v1/admin/users/$U/tabspaces/ts_..."
curl -s -b $J "$B/console/api/v1/admin/users/$U/search?q=hello"
curl -s -b $J -X DELETE "$B/console/api/v1/admin/users/$U/devices/dev_..."

# the operator's directory (and the filter it needs)
curl -s -b $J "$B/console/api/v1/admin/users"
curl -s -b $J "$B/console/api/v1/admin/users?q=alice"
curl -s -b $J -X PUT "$B/console/api/v1/admin/users/$U/role" -d '{"role":"admin"}'
curl -s -b $J -X POST "$B/console/api/v1/admin/users/$U/impersonate"
curl -s -b $J "$B/console/api/v1/console/impersonation"
curl -s -b $J -X POST "$B/console/api/v1/console/impersonate/stop"

# then retire the dead device (revokes and archives its tokens, then archives it)
curl -s -b $J -X PUT "$B/console/api/v1/admin/users/$U/devices/dev_.../archive"
curl -s -b $J -X PUT "$B/console/api/v1/admin/users/$U/devices/dev_.../records/archive"
curl -s -b $J "$B/console/api/v1/admin/users/$U/records?archived=1"   # show archived
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
| Archive a device | `PUT .../devices/{id}/archive` | none: it revokes and archives the device's tokens, then archives the device, in one step |
| Archive what it wrote | `PUT .../devices/{id}/records/archive` | no usable token left (archiving the device satisfies this) |
| Undo any of the above | `DELETE` the same paths | - |

Unarchiving never re-enables access: a revoked token stays revoked. A record
that is edited again un-archives itself, because it is live again; tombstones
are not restored.

### Console sessions (ADR 0021)

A console sign-in lasts `TABVERSED_SESSION_TTL` (default 24h) and then ends: the
server refuses the token even though the browser is still offering it, and clears
the cookie. Set `0` for the old behaviour, where a session in use renewed itself
for as long as it kept being used.

| Step | Endpoint | Who |
| ---- | -------- | ---- |
| Sign out of this browser | `POST /console/api/v1/console/signout` | anyone signed in |
| Sign out of every browser | `POST /console/api/v1/console/revoke-sessions` | the account itself (audited) |
| The same, for somebody else | `PUT .../admin/users/{user_id}/revoke-sessions` | an operator |

"Sign out everywhere" moves the account's revocation cut-off
(`users.tokens_valid_after`), so it ends console sessions and nothing else. The
extension's device tokens are a different credential with no expiry, and they
keep syncing - unpair them from **Devices & Tokens** if that is what you want.
A cut-off is compared at second granularity, so a session minted in the same
second survives it.
