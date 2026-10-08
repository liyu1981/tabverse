# ADR 0020: the official server pairs by wizard, and a web page carries the token

Status: accepted (2026-10)

Extends [ADR 0001](0001-server-authoritative-sync.md) (pairing exists) and
[ADR 0012](0012-accounts-are-for-the-console.md) /
[ADR 0013](0013-no-master-credential.md) (accounts are for the console).
Companion plan: `doc/tabverse-sync-setup-plan.md`.

## Context

Pairing was designed for a server the user runs: the account mints an invite
code (`POST /api/v1/auth/invites`), the extension redeems it (`POST /api/v1/auth/pair`),
and nobody needs the network to be trusted beyond the server the person chose.
That is the right shape for self-hosting and stays as it is.

It is one step too many for the server *we* run, where the person at the
keyboard owns the account: they should sign in on a page they recognise, name
their device, and be done. Three things made that awkward:

1. **The extension cannot sign in.** The session is a cookie in the browser's
   jar for that origin; an extension page has its own cookie jar and cannot
   complete a sign-in for `tabversed.liyu1981.xyz`.
2. **A credential has to cross back** from a page that *is* signed in, to the
   extension.
3. The console already has everything else: the session, `writeDevice` (create a
   device and its token, returned once), and a middleware whose rule is exactly
   *"a signed-in person may act on their own account"* (`internal/api/admin.go`).

## Decision

**The official server pairs through a wizard, and the token is carried by a web
page. The invite-code flow is unchanged and remains how a self-hosted server is
paired.**

1. **The channel is `externally_connectable`.** The extension declares one
   origin — `https://tabversed.liyu1981.xyz/*` — and the page calls
   `chrome.runtime.sendMessage(extensionId, …)`, which Chrome allows only for
   declared origins. This is the one mechanism among the alternatives that
   survives a closed `window.opener` (the popup that could open the window
   closes itself), does not depend on navigating to an `chrome-extension://` URL
   (not a supported hand-back), and does not need the session in the extension.
2. **The request travels in the URL, the answer in a message.** The
   window the extension opens is the console's pairing page,
   `/console/pair?ext=<its own id>&nonce=<uuid>` (it began as the fragment
   `#pair=1&…`, moved into the query with
   [ADR 0023](0023-the-console-has-its-own-prefix.md) and onto a path of its own
   with [ADR 0024](0024-the-root-is-a-site-and-the-api-moved.md)).
   The id is the extension's own, which is what makes an unpacked build work;
   the nonce is what makes an unsolicited message ignorable.
3. **The server mints from the session.** `POST /api/v1/console/pair` takes
   `{device_name, extension_id}` and calls the existing `writeDevice`. The
   account is the session's — there is **no account parameter** — and an assumed
   identity is refused as on every other mutating console route: a token issued
   under an impersonation would outlive it.
4. **The extension accepts it in the service worker** (`onMessageExternal`), which
   is the context that is always there — a message can arrive with no page open,
   because the person is looking at the wizard window. Four checks, cheapest
   first: message type, sender origin, the nonce this device asked for (spent on
   read), credentials present. Only then is `SyncConfig` saved, with
   `kind: 'official'`. The dialog listens for the same message and runs the same
   checks, so a worker that did not wake loses nothing (the dialog is open by
   construction — it opened the window).
5. **The wizard's request survives sign-in.** Both sign-in paths come back to the
   console root (`withConsoleReturn` sets `?from=` server side, deliberately
   overruling a caller-supplied target), so the pair request is stashed in
   `sessionStorage` and read back on the way in. It is `sessionStorage` because
   this is one window's business, and it expires with the browser run.
6. **The dialog becomes two tabs**: *Status* (what sync is — host, device,
   account, last sync, sync now / upload / disconnect) and *Setup* (a switch
   between the wizard and the code form). `SyncConfig` gains
   `kind?: 'official' | 'custom'`, where **absent means custom**, so every
   config that already exists keeps working without a migration.
7. **The wizard's base URL is one exported constant**
   (`OFFICIAL_SERVER_URL`), because the manifest's match pattern and the URL the
   extension opens must agree, and a policy test pins them together.

## Consequences

- **A bearer credential passes through a web page.** It is the official origin's
  own page, over https, and it is never rendered into the DOM — it goes straight
  into the message and the page shows "connected". The privacy notes say this
  plainly.
- **Other extensions can no longer connect to us.** The manifest reference is
  explicit: declaring `externally_connectable` without `"ids"` is what stops
  them. Nothing ever did, so nothing is lost — and adding `"ids": ["*"]` "to be
  safe" would undo the narrowing.
- **The extension now has one origin it trusts to send it credentials.** That is
  the whole blast radius, stated in the manifest and asserted by a test.
- **Disconnect stays local.** It forgets the credentials; the device row stays
  on the server until it is revoked by hand (or a self-revoke endpoint, which is
  the natural follow-up).
- **Unverified by me:** whether an external message wakes a sleeping service
  worker (mitigated by the dialog listening too — see decision 4), and what is
  deployed on the official host today. Both are on the plan's user-check list.
