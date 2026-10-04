# Plan: sync setup — an official-server wizard, and a tabbed dialog

Status: **built** (2026-10), and `adr/0020-official-server-wizard-pairing.md`
records the decisions. §10 is where the build left the plan behind.
Extension + server + console. Follows the server pivot (`adr/0001`), privacy
(`adr/0002`), accounts (`adr/0012`, `adr/0013`) and the console as a Vite app
(`adr/0018`).

## 0. What is being asked

1. The **current token/invite-code process becomes the "custom server"** path —
   unchanged, and still what a self-hosted deployment uses.
2. A **new "official server" wizard**: click → a new browser window → sign in →
   an agree page where you name the device → the server issues a token and
   creates the device entry → the page sends the token to the extension through
   a cross-page message channel → the extension saves it as the sync config.
   Official server for now: `https://tabversed.liyu1981.xyz`.
3. Then the sync dialog becomes **tabbed**: *Status* (current setup, last sync
   time, disconnect) and *Setup* (switch between custom and the wizard).

## 1. Where we are

- **`src/ui/dialog/ServerSyncDialog.tsx` (437 lines)** already has most of
  point 3's content, flat in one dialog: when configured it shows `baseUrl`,
  device id, account id, the syncing spinner, `Last sync: …`, and three buttons
  (**Sync now**, **Upload local data**, **Disconnect** → `clearSyncConfig`).
  When not configured it shows the custom form (baseUrl + invite code + device
  name + upload checkbox → `pairWithServer`). So the Status tab is a
  *restructure*, not new logic.
- **`syncConfig.ts`**: `SyncConfig {baseUrl, token, userId?, deviceId?, enabled,
  autoSyncIntervalMs?}` in `chrome.storage.local` under
  `tabverse_sync_config_v1`, with `pairWithServer()` = redeem an invite, save.
- **Server**: `writeDevice` (`internal/api/auth_handlers.go`) already creates a
  device + token and returns the credentials exactly once — it is what
  `bootstrap` and `pair` both use. `POST /api/v1/auth/pair` is invite-gated;
  `POST /api/v1/console/*` style routes authenticate through
  `consoleCredential`, whose rule is *"a signed-in person may act on their own
  account"* (`admin.go:71`), with an assumed (impersonated) identity refused on
  every mutating route.
- **Accounts**: email-link sign-in plus Google/GitHub, session cookie
  (`tv_session`) + XSRF header, and `withConsoleReturn` (`accounts/service.go:229`)
  which puts the console on `?from=` of every provider login.
- **The console is hash-routed** (`server/ui/data/hashRoute.ts`: `#tab=…`), and
  `writeHash` preserves keys it is not asked to change — so a new pair view can
  add keys without touching `RouteState`.
- **The official server is live**: `curl https://tabversed.liyu1981.xyz/healthz`
  → `{"status":"ok","version":"dev"}`, with the same CORS headers our
  `withCORS` writes (note: `allow-methods` has **no PUT**, see G3).

## 2. Feasibility of point 2 — validated

**Verdict: feasible, with two things to confirm in a browser.** Everything below
was checked against Chrome's current docs, a live probe of the official server,
or this repo's code — not from memory.

### The channel: `externally_connectable` + `runtime.sendMessage`

Chrome's own text (messaging reference):

> To send messages from a web page to an extension, specify in your manifest.json
> which websites you want to allow messages from using the `externally_connectable`
> manifest key … This exposes the messaging API to any page that matches the match
> patterns you specify. Use the `runtime.sendMessage()` or `runtime.connect()` APIs
> to send a message to a specific extension.

and the manifest reference: *"If the `externally_connectable` key is not declared
… no web pages can connect"* — which is our current state, so this is additive:
no permission, no CSP change (`connect-src` is already `https:` and messaging is
not a fetch).

```json
"externally_connectable": { "matches": ["https://tabversed.liyu1981.xyz/*"] }
```

The page then calls `chrome.runtime.sendMessage(extensionId, …)`; the extension
answers from `chrome.runtime.onMessageExternal`. **The address of the extension
is the one thing the page does not know**, and the extension knows its own id —
so the window it opens carries it, plus a nonce the answer must echo:

```
https://tabversed.liyu1981.xyz/#pair=1&ext=<chrome.runtime.id>&nonce=<uuid>
```

That also makes it work for an unpacked dev build, whose id is not the store's.

**Channel alternatives, and why not:**

| | Why rejected |
|---|---|
| `window.opener.postMessage` from the site | Needs a live opener. The popup closes itself (`window.close()`), `chrome.windows.create` has no opener, and a closed manager page takes the channel with it. |
| Redirect the site back to `chrome-extension://<id>/…` | Top-level navigation to an extension resource from a web page is not a supported hand-back. |
| Have the extension poll for the token | It would need the page's session cookie; the cookie jar is not the extension's. |

### The server: everything it needs already exists

- **Sign-in**: the console's own flow, and `?from=` already carries a return
  target through every provider.
- **Minting**: `writeDevice(ctx, dev_id, userID, deviceName)` creates the device
  row *and* the token, returns them once — one handler + the
  `consoleCredential` middleware (session for one's own account, assumed
  identity refused because it is mutating) is the whole endpoint.
- **Live**: `/healthz` on the official host answers (above).

### The client: one small saver

`saveSyncConfig` already persists what `pairWithServer` returns; the wizard
needs the same config built from `DeviceCredentials` **without** the invite
leg. `pairWithServer` is the template.

### The two things I could not verify from here

1. **Does an external message wake a sleeping service worker?** The reference
   says `onMessageExternal` "fires when a message is sent"; the service-worker
   event model says a top-level listener starts the worker, but I could not find
   that stated for this event. **Mitigation makes it moot:** register the
   listener in *both* the worker and the dialog page — the dialog is open by
   construction, because it is what opened the window. If the worker also wakes,
   a closed dialog cannot lose the token.
2. **The official server's own build.** It answers `version: dev`; the pair view
   and its endpoint are work on that deployment (this repo builds it), but I
   cannot verify from here what is already running there today.

Nothing else about point 2 is speculative: no new permission, no CSP change, no
`host_permissions` change, no server schema change (the `devices` and `tokens`
tables already exist), and the token's path into `chrome.storage.local` is one
existing function.

## 3. Decisions

| # | Question | Decision | Why |
|---|----------|----------|-----|
| D1 | Which channel? | `externally_connectable` + `runtime.sendMessage` | The only one that survives a closed opener and is documented (§2). |
| D2 | How does the site know which extension? | The window the extension opens carries `#pair=1&ext=<chrome.runtime.id>&nonce=<uuid>`; the page messages **only** that id | Works for unpacked ids; the nonce binds one answer to one window. |
| D3 | Where does the token live in transit? | The page sends it and never renders it, then shows "you can close this window". The extension checks `sender.origin` **and** the nonce before saving | The token is a bearer credential; it must not be painted into a DOM or logged. |
| D4 | Server endpoint | `POST /api/v1/console/pair` — session + XSRF, own account only, calls `writeDevice` | The middleware already encodes the rule, and an assumed identity is refused on it (mutating). OpenAPI + README updated with it. |
| D5 | Where does the pair view live? | A hash route on the console: `#pair=1&ext=…&nonce=…`, and `?from=` must be built from `pathname + search + hash` so login returns to it | Reuses sign-in, the console's look and its client (`api.ts` sets the XSRF header). |
| D6 | What kind of window? | A normal window (`chrome.windows.create({url})`), closed by the extension after a successful hand-off | Provider sign-ins (Google/GitHub) are happiest in a normal window, and it is what the user recognises as "the browser opened a page". The extension made it, so it may close it. |
| D7 | What if the page cannot reach the extension? | It says so and points at **Custom setup**. No second "type this code" protocol in v1 | A second protocol to design, test and support, for the case of a link opened in a different browser. Custom setup already works with no server cooperation. |
| D8 | Where is the listener? | In the service worker (top-level) **and** in the dialog page that opened the window | Removes the unverified service-worker wake from the critical path (§2). |
| D9 | How does the status tab know which kind of setup this is? | `SyncConfig` gains `kind?: 'official' \| 'custom'`; **absent means custom** | Backward compatible: existing configs keep working without a migration, and the field is display-only. |
| D10 | Dialog structure | Blueprint `Tabs`: **Status** and **Setup**. Default tab: Status when configured, Setup when not. Setup carries a switch between *Official (recommended)* and *Custom server* | The state machine already exists (`config ? status : form`); tabs make it explicit instead of replacing one view with the other. |
| D11 | Custom path changes? | No. Same invite code, same `pairWithServer`, same bootstrap/`TABVERSED_ADMIN_TOKEN` story | Self-hosting is the feature; the wizard is an addition, not a replacement. |
| D12 | Disconnect | Stays local-only (today's `clearSyncConfig`), v1 | Server-side self-revoke needs a new endpoint for a credential we already hold; it is worth doing but not needed to ship the flow (see §9). |
| D13 | The official URL | One exported constant (`src/data/repo/officialServer.ts`), not a hard-coded literal spread through the UI | One place to change it (and to point a build elsewhere later), and one place for the manifest's match pattern to agree with. |
| D14 | `externally_connectable` scope | Only `https://tabversed.liyu1981.xyz/*`; no `ids` entry | Per the manifest reference, omitting `ids` means other extensions cannot connect to us either — nothing today needs that, so nothing loses it. |

## 4. Work items, in order

1. **ADR 0020** — the decision (D1–D6, D14), why the token passes through a
   web page, and what the extension now accepts messages from.
2. **Server**: `POST /api/v1/console/pair` (`internal/api/pair_handlers.go`),
   `consoleCredential` middleware, `writeDevice` reuse; tests; `api/openapi.yaml`;
   `server/README.md`.
3. **Console pair view** (`server/ui/views/PairView.tsx` + hash keys): not
   signed in → sign-in with `from` preserving the hash; agree form (device name,
   "Tabverse on *chrome*", and what syncing implies); POST → send to `ext` →
   done state; error/fallback state (D7). `renderToStaticMarkup` tests.
4. **Manifest + worker**: `externally_connectable`, `onMessageExternal` at the
   top level of `background.ts`, origin + nonce checks, `saveSyncConfig` with
   `kind: 'official'`, and a `BackgroundMsg.SyncConfigChanged` so an open dialog
   redraws (same pattern as `SyncActivityChanged`).
5. **Client flow**: `startOfficialSyncFlow()` in
   `src/data/repo/officialServer.ts` — nonce, `chrome.windows.create`, listener,
   close-on-success; unit tests with the chrome mock.
6. **Dialog**: tabs (D10), Status tab = today's paired view + `kind` label,
   Setup tab = the switch + today's custom form + the official button with its
   waiting state; markup tests.
7. **Docs**: `ARCHITECTURE.md` (setup section), `server/README.md`, and the
   store disclosure + privacy policy — the extension can now reach *our* server
   in one click, which is a sentence the policy does not have today.

## 5. Files

| Path | What |
|------|------|
| `adr/0020-official-server-wizard-pairing.md` | the decision |
| `server/internal/api/pair_handlers.go` (+test) | the mint endpoint |
| `server/ui/views/PairView.tsx` (+test) | sign-in → agree → done |
| `server/ui/data/hashRoute.ts` | `pair` keys survive login |
| `api/openapi.yaml`, `server/README.md` | contract + docs |
| `src/manifest.json` | `externally_connectable` |
| `tools/manifestPolicy.test.mts` | assert the match pattern is only the official origin |
| `src/background.ts` | `onMessageExternal` |
| `src/data/repo/officialServer.ts` | constant + flow |
| `src/data/repo/syncConfig.ts` | `kind`, `adoptSyncCredentials` |
| `src/ui/dialog/ServerSyncDialog.tsx` | the tabs |
| `ARCHITECTURE.md`, `doc/chrome-webstore/listing.md`, `docs/privacy` | docs |

## 6. Gotchas

- **G1 — `ids` is omitted on purpose** (D14): adding the key without `ids` is
  what stops other extensions from connecting to us. Nothing does today; do not
  "fix" it later by adding `"ids": ["*"]`.
- **G2 — The token is a bearer credential passing through a web page.** It is
  the official origin's own page, over https, and it is never rendered — but
  the privacy note should say it plainly.
- **G3 — No `PUT` on the wire.** The live server's CORS is
  `GET, POST, DELETE, OPTIONS` (probed). The pair endpoint is `POST`; do not
  reach for `PUT` for anything in this flow without also changing `withCORS`.
- **G4 — The nonce is state for the duration of one window.** The dialog holds
  it in component state (it is open, D8); the worker's copy comes from the URL
  it opened. If both listeners race, the first valid answer wins and the second
  is ignored because the nonce was consumed.
- **G5 — `?from=` must carry the hash.** A provider round trip that drops
  `#pair=…` lands the user on the console's home page with an orphaned flow;
  build `from` from `pathname + search + hash`.
- **G6 — Unpacked ids differ per checkout.** Nothing hard-codes the id: the
  extension always passes `chrome.runtime.id`.
- **G7 — Session POSTs need `X-XSRF-Token`.** The console's `api.ts` sets it;
  the pair view must go through that client, not a bare `fetch`.
- **G8 — The dialog must be the thing that opens the window.** If the flow ever
  starts from somewhere that closes afterwards, D8's worker listener is what
  keeps it working — do not remove it "because the dialog is open".
- **G9 — Disconnect does not tell the server** (D12). A disconnected official
  device leaves an entry in the account's device list until revoked by hand.
- **G10 — The store disclosure and privacy policy must be updated** before this
  ships: "can reach our server by default" is a sentence neither document has.

## 7. Tests

| Suite | What it pins |
|-------|--------------|
| `server/internal/api/pair_test.go` | 401 without a session; XSRF required; a signed-in account mints exactly one device+token (returned once); an assumed identity is refused (mutating); the caller cannot mint for another account |
| `server/ui/views/PairView.test.tsx` | agree form renders with the device name defaulted; done state after POST; fallback state when the page cannot reach an extension; the hash keys are read |
| `src/data/repo/__tests__/officialServer.test.ts` | nonce is echoed and single-use; a message from the wrong origin is ignored; a wrong nonce is ignored; a valid one saves `kind: 'official'` |
| `src/data/repo/__tests__/syncConfig.test.ts` (extended) | `kind` absent ⇒ custom; `adoptSyncCredentials` writes the same shape `pairWithServer` does |
| `tools/manifestPolicy.test.mts` (extended) | `externally_connectable.matches` is exactly the official origin — one entry, https |
| `src/ui/dialog/__tests__/ServerSyncDialog.test.tsx` | both tabs render; configured ⇒ Status is default and shows last sync + Disconnect; not configured ⇒ Setup is default and offers both paths; the official button shows a waiting state |

## 8. Verification

`pnpm test`, `pnpm run typecheck`, `lint:check`, `format:check`, `build`, and —
because the server changes — `pnpm run server:vet` and
`pnpm run server:test-race`.

**In Chrome (the user's, per AGENTS.md):**

1. Setup → *Official* → the window opens on `#pair=1…`; sign in; agree with a
   device name → the extension saves it, the window can be closed, and the
   **Status** tab shows the official host, the device id and "Not synced yet",
   then a real `Last sync` after the first cycle.
2. Close the dialog and reopen it: the status survives (it is the config).
3. Custom setup still pairs an invite code against a self-hosted server.
4. Open the pair link in a *different* browser (or with the extension disabled):
   the page says it could not reach Tabverse and points at Custom setup.
5. Disconnect: config gone, status tab back to Setup, data still local.

## 9. Not in this increment

- **Disconnect revoking the token server-side** (G9): needs
  `POST /api/v1/console/devices/self-revoke`; worth doing next.
- **Moving an existing custom pairing into the wizard**, or the reverse — a
  config either points at a server or it does not; `kind` is display-only.
- **Presence** (`doc/tabverse-open-presence-plan.md` §11) — untouched.
- **The official server's operations**: monitoring, backups, retention
  decisions for that deployment.

## 10. Where the build differed from the plan

1. **Sign-in return target: stashed, not carried.** D5/G5 assumed the pair
   request could ride back through `?from=`. It cannot, and changing
   `withConsoleReturn` to honour a caller-supplied `from` would weaken a deliberate
   server-side decision (it overrides it precisely so a query parameter cannot
   choose where a login lands). So the page stashes the request in
   `sessionStorage` before it sends anyone to sign in, and reads it back on the
   way in (`server/ui/data/pair.ts`). Same tab, gone with the browser run, and
   one window's business only.
2. **The sign-in branch is the console's own form**, under a banner that says
   why this page is here. It reuses `SignInView` rather than re-implementing the
   providers, and the pair view returns once the stash is read.
3. **The two tabs' decisions are exported and tested instead of the markup.**
   Blueprint's `Dialog` is a portal and yields nothing to a static render - there
   is no DOM in this repo's tests to render one through (AGENTS.md) - so
   `initialSyncTab` (Status when configured, Setup when not) and `setupLabelOf`
   (official vs code) are the tested surface, and what the tabs *look* like is on
   the user's check list.
4. **The wizard button pair is a `ButtonGroup`, not a RadioGroup** — two halves
   of one control read as a mode, which is what it is.
5. **The manifest allow-list is pinned to the constant** by
   `tools/manifestPolicy.test.mts`: the two live in different files and a
   mismatch would be a pairing that can never be delivered, which nothing would
   notice until somebody tried.
6. **Disconnect remains local** (D12), and the store's disclosure answers were
   updated rather than left to be corrected at submission time: the official
   server is now a possible destination, and an email address can exist on it
   (`doc/chrome-webstore/listing.md`, `docs/privacy/index.html`).
