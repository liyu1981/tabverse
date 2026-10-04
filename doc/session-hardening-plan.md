# Plan: console session hardening

Status: **built (2026-10)**. ADR 0021 records the decisions; this is what it was
built from. Follows ADR 0012 (accounts are for the console), ADR 0013 (no master
credential), ADR 0014 (the console is a directory then an account) and ADR 0018
(the console is a Vite app).

Extension-side sync is not in scope except where noted. Everything here is
about the **console's own session** — the `tv_session` cookie an operator
carries into the web UI.

---

## 0. What we have today

Three numbers, hard-coded in `server/internal/accounts/service.go:136-138`:

```go
TokenDuration:  12 * time.Hour,
CookieDuration: 30 * 24 * time.Hour,
```

Neither is configurable. The two library behaviours that matter:

| Behaviour | Where | Effect |
| --- | --- | --- |
| A cookie-borne token's expiry is **ignored** | `token/jwt.go:225-243` (`validate` swallows `ErrTokenExpired`), `:332` (`Get` only re-checks expiry when the token did *not* come from a cookie) | the 12h token lifetime is **not enforced server-side** |
| An expired token is silently re-minted, with a fresh cookie | `middleware/auth.go:145-153` → `token/jwt.go:273-284` | every refresh sets `Max-Age: 30d` again — the session **slides forever** |

So the honest answer to "how long does a console session last" is **30 days
since the last request, without limit**, and the 12h figure in the config is
decoration.

What we already have that is worth keeping:

- `users.tokens_valid_after` (`store/accounts.go:300-315`) plus
  `SessionAllowed` (`accounts/accounts.go:161-187`) — an account-wide
  revocation cut-off, checked on **every** authenticated request through the
  `Validator` hook (`service.go:396-406`). Account deletion and disabling both
  bump it.
- XSRF: a non-`HttpOnly` `tv_xsrf` cookie echoed in `X-XSRF-Token`, enforced on
  every non-GET (`service.go:144-149`).
- `SameSite=Lax` (needed for the OAuth redirect back), `HttpOnly` on the session
  cookie, `Secure` whenever `TABVERSED_PUBLIC_URL` is https.
- Impersonation is a separate cookie, 15 minutes, read-only
  (`api/impersonate.go:28`), and is audited.

---

## 1. What is actually wrong

Ranked by what a real deployment is exposed to.

1. **A session never ends.** No idle timeout, no absolute cap, no way for an
   operator to see or end one. A cookie lifted off a shared or backed-up
   machine stays good as long as somebody uses it, and since use renews it,
   an attacker never has to touch it again.
2. **No "sign out everywhere".** `tokens_valid_after` is the mechanism and it
   already exists — but nothing writes it on demand. Only `SetPasswordHash`
   (dead code: passwordless) and `SetDisabled` write it. So for a person whose
   session was stolen, the only remedy today is to disable the account.
3. **Sign-in is not recorded.** `AuditLogin` and `AuditLoginFailed`
   (`store/accounts.go:36-37`) are declared and **never written anywhere** —
   `grep -rn 'AuditLogin\b' --include=*.go` returns only the constant. Only
   sign-out is audited (`api/console.go:101`). After an incident there is no
   answer to "who signed in, when, from where".
4. **`POST /api/v1/console/signin-link` is unauthenticated and unthrottled**
   (`api/server.go:129` → `api/console.go:160`). It creates the account and
   sends mail, with no rate limit: one script can mail-bomb an address and
   create unbounded accounts.
5. **The sign-in link's one-shot guarantee is in memory.**
   `VerifConfirmationStore` is left nil, so the library installs
   `NewInMemoryVerifStore` (`provider/verify.go:100-108`). A used link is
   replayable until its 30-minute expiry if the server restarts in between, and
   the guarantee does not survive a second replica.
6. **A 30-day persistent cookie outlives the person using it.** Even once the
   server stops honouring it, a `Max-Age: 2592000` cookie sits on a shared
   machine's disk.

---

## 2. Three decisions I need from you

> **Answered: D1 (a) hard cap, D2 24h, D3 no sessions table.** Phase 6's refusal
> shipped **opt-in** (`TABVERSED_REQUIRE_HTTPS`, default off) rather than as
> planned, because turning the plain-http warning into a startup failure breaks a
> LAN deployment on upgrade, and that is a product decision rather than a
> hardening detail. ADR 0021 carries the reasoning.

**D1 — the session policy.** Three shapes, and this is the whole design:

| | Behaviour | Cost |
| --- | --- | --- |
| **(a) hard cap** *(recommended)* | sign-in lasts at most `SESSION_TTL`, then it is over; re-login | re-login every N hours. No schema. |
| (b) sliding | every request renews, bounded by an absolute cap (needs a `session_started` claim + either a table or `DisableIAT`) | more machinery for a console nobody looks at daily |
| (c) keep sliding, shorten the cookie | 30d → 7d. Still unbounded while the tab is open | cheapest, weakest |

I recommend **(a)**, because an admin console is not a daily-driver app and
because it is the only option that needs no new state: a single expiry check.

**D2 — the number.** With (a), the session is the token TTL. Default **12h**
(unchanged) or **24h**? I would go 24h: one sign-in a day is invisible, and it
is still a hard bound. `0` = no expiry, for a LAN deployment that wants the old
behaviour.

**D3 — the sessions table.** Do we want per-session state (a `sessions` table
keyed by the claim's `jti`, which is already a random per-session id and
survives refreshes), which buys a session list in the console and per-session
kill, or only the cheap "sign out everywhere" button that `tokens_valid_after`
already supports? I would do **the button first**, table only if D1 is (b).

---

## 3. The plan

### Phase 1 — enforce the bound (closes finding 1, the actual hole)

- Make the two lifetimes real configuration:
  `TABVERSED_SESSION_TTL` (token, default per D2) and
  `TABVERSED_SESSION_COOKIE_TTL` (cookie, default = `TABVERSED_SESSION_TTL`).
  Read in `config.Load` next to where `SyncBatchLimit` is parsed; remove the
  literals from `auth.Opts`.
- **Set `CookieDuration = TokenDuration` by default.** With a hard cap the
  cookie only has to outlive the token, and matching them means the browser
  drops the credential at the same moment the server does — nothing stale left
  on a shared machine (finding 6).
- Enforce the expiry in the hook that already runs before the library's refresh:
  in `validate` (`service.go:396-406`), reject when `claims.ExpiresAt` is in the
  past. The library calls `Validator` at `middleware/auth.go:129-135`, which is
  *before* `IsExpired`/`refreshExpiredToken` at `:145`, and a false return makes
  it call `JWTService.Reset` — so the cookies are cleared and the console gets a
  clean 401 on its next `/console/me` instead of a silently-renewed session.
- Keep `SessionAllowed` and the `tokens_valid_after` check in the same hook;
  they compose, and `SessionAllowed` stays the one copy of that rule.

Tests: a token past `ExpiresAt` is refused even when presented as a cookie; a
`Set-Cookie` on the refusal clears both cookies; the cut-off still refuses a
freshly-minted token; `0` disables the check.

### Phase 2 — "sign out everywhere" (finding 2)

No new storage — `SetPasswordHash` already shows the one-line shape.

- `store.RevokeAllSessions(ctx, userID)`: `UPDATE users SET tokens_valid_after = ?`.
- `POST /api/v1/console/revoke-sessions`, owner-only, and the same call for an
  operator from the account view. `AuditEntry{Action: AuditSessionsRevoked}` with
  the client IP.
- The console asks for it with the existing `TypedConfirmDialog` and says
  plainly: every browser is signed out, the device sync tokens are **not**
  affected (they are a different credential, `tokens` table — finding 2 must not
  be conflated with the device archive work).

### Phase 3 — write the sign-in audit trail (finding 3)

- `AuditLogin` on a successful session, `AuditLoginFailed` on a refused one,
  both with `clientIP` (`api/console.go:126`, already there).
- Sign-in is minted inside the library, so the hook is a small
  `ResponseWriter` wrapper on the `/auth` mount that catches `Set-Cookie:
  tv_session`, parses it, and writes the audit row — the same technique
  `Assume` already uses to re-emit a cookie under a different name
  (`service.go:516-570`). Recording only successes is defensible; recording
  every refusal needs a noise decision, hence it below.
- `AuditSessionsRevoked`, `AuditLogin`, `AuditLoginFailed` stop being unused
  constants.

### Phase 4 — throttle the sign-in path (finding 4)

- Per-IP and per-address token bucket on `POST /api/v1/console/signin-link`,
  in-process, no schema: e.g. 5/hour per address and 20/hour per IP.
- Nothing in the response may distinguish "account exists" from "account just
  created"; check what `handleConsoleSigninLink` (`api/console.go:167`) and the
  library's verify handler return, and flatten anything that hints either way.
- A 429 with a plain English body the console shows.

### Phase 5 — durable one-shot links (finding 5)

- Implement `VerifConfirmationStore` over `email_tokens` (the table already
  exists, `store/store.go:115`, and already stores a hash plus an expiry) and
  wire it into `auth.Opts`. Survives restart, works across replicas.

> **As built:** a new `verif_tokens` table instead. `email_tokens.user_id` is
> `NOT NULL REFERENCES users(id)`, and a link is redeemed *before* it resolves to
> an account — at redemption time there is only a hash. Swept once at startup.

### Phase 6 — transport and deployment posture (finding 6, partially)

- HSTS on the console when `SecureCookies` is on. Cheap, no downside.
- The `http://` warning at `service.go:106-116` exists and stays. Optionally
  **refuse to start** on a non-loopback `http://` `TABVERSED_PUBLIC_URL` —
  behind an escape hatch (`TABVERSED_ALLOW_INSECURE_PUBLIC_URL`) so existing
  LAN deployments are not broken on upgrade. **Needs your call.**

---

## 4. What deliberately does not change

- **Device/sync tokens keep having no expiry.** They are the extension's
  credential; `tokens` has no expiry column by design and revocation is the
  verb. Changing that is ADR territory and would break pairing.
- **Passwordless stays passwordless.** No credential to rotate, so Phase 2's
  button is the entire "I think I'm compromised" story, and it should read that
  way in the console.
- **`SameSite=Lax`.** `Strict` breaks the Google/GitHub redirect back.
- **Impersonation's 15 minutes.** Already short, already separate, already
  audited.

---

## 5. Verification

- Go: `go vet`, `go test -race ./...`; new tests in `accounts` and `api` for
  the expiry, the cut-off, the throttle and the audit rows.
- The cookie changes are asserted on the wire (`Set-Cookie` attributes and
  `Max-Age`), not through a browser.
- The console UI is **not** verified here — per `AGENTS.md` the user checks the
  UI, and Phase 2's dialog is theirs to look at.

## 6. Cost

| Phase | Size | Risk |
| --- | --- | --- |
| 1 | ~60 lines | low — the only behavioural change users will notice is a daily sign-in |
| 2 | ~80 lines | low |
| 3 | ~80 lines | low |
| 4 | ~100 lines | low |
| 5 | ~80 lines | low |
| 6 | ~20 lines + a decision | medium — refusing to start breaks deployments |

Phases 1 and 2 are the ones that matter; 3-5 are hygiene; 6 is optional.