# ADR 0021: a console session ends

Status: accepted (2026-10)

Extends [ADR 0012](0012-accounts-are-for-the-console.md) (the console's login
lives in a session cookie), [ADR 0013](0013-no-master-credential.md) (accounts
are the only credential) and [ADR 0014](0014-console-is-a-directory-then-an-account.md).
Plan: [`doc/session-hardening-plan.md`](../doc/session-hardening-plan.md).

## Context

The console's session was two numbers in `auth.Opts`: `TokenDuration: 12h` and
`CookieDuration: 30d`. Both were literals, and neither meant what it said.

The auth library deliberately does not enforce a cookie-borne token's expiry -
`token.Service.validate` swallows `ErrTokenExpired` and `Get` only re-checks it
for a token that did not arrive in a cookie. `middleware.Authenticator.Auth` then
sees the expired token, mints a fresh one, and `Set` writes a new cookie with the
full `CookieDuration`. So the twelve hours never elapsed for a session in use,
and the answer to "how long does a console session last" was **thirty days
since the last request, without limit**.

Around that:

- `users.tokens_valid_after` - an account-wide cut-off that would make "sign out
  everywhere" a one-liner - existed and was read on every authenticated request,
  but nothing wrote it on demand. Only disabling an account did.
- `AuditLogin` and `AuditLoginFailed` were declared constants, never written
  anywhere. Sign-out was recorded; sign-in was not.
- `POST /api/v1/console/signin-link` was unauthenticated and unthrottled, and it
  creates an account and sends mail.
- The email says the link "works once". That was enforced by the library's
  default in-memory confirmation store, so the guarantee lasted exactly as long
  as the process.
- A `Max-Age: 30d` cookie outlives the person using it. Even once the server
  stopped honouring a session, the browser went on presenting a credential to
  whatever else ran on that machine.

## Decision

**A console session ends at a fixed time, is revocable on demand, and a sign-in
is written down.**

1. **The server enforces the token's own expiry.** `Service.validate` - the
   `Validator` hook that already carries the revocation check - also refuses a
   claim whose `ExpiresAt` has passed. The authenticator calls `Validator`
   *before* it refreshes, so the refresh never happens and the session ends.
   `TABVERSED_SESSION_TTL` (default `24h`) sets how long a sign-in lasts; `0`
   is the documented "no bound", which is the pre-hardening behaviour.

2. **The cookie does not outlive the session.**
   `TABVERSED_SESSION_COOKIE_TTL` defaults to the session's own length, so the
   credential leaves the machine when the session does rather than sitting on
   disk for weeks after the server has stopped honouring it.

3. **"Sign out everywhere" is a supported operation.**
   `POST /api/v1/console/revoke-sessions` for one's own account and
   `PUT /api/v1/admin/users/{user_id}/revoke-sessions` for an operator's move it
   to the revocation cut-off and write `sessions_revoked`. The console's dialog
   says plainly that **device tokens are not touched**: they are a different
   credential, and "sign out everywhere" must not read as "unpair my devices".

4. **A sign-in is audited.** `AuditLogin` is written when the auth handlers set
   a `tv_session` cookie, `AuditLoginFailed` when they answer 401 or 403 without
   one. The observation point is the response, because the session is minted
   inside the library and there is no login callback.

5. **The sign-in link is throttled.** Five an hour per address and twenty per
   IP, in process, no storage. The refusal body is identical whoever the
   address is, so the endpoint cannot be used as an account directory.

6. **"Works once" is kept in the database.** The library's
   `VerifConfirmationStore` is implemented over a `verif_tokens` table, so the
   guarantee survives a restart and holds across replicas. Its own table rather
   than `email_tokens`, because that one has a NOT NULL foreign key to `users`
   and a link is redeemed before it resolves to an account.

7. **Transport is asserted, not assumed.** HSTS is sent where the session cookie
   is `Secure`. Refusing to start on a plain-http non-loopback public URL is
   **opt-in** (`TABVERSED_REQUIRE_HTTPS`, default off), because a LAN
   deployment on `http://192.168.x.x` is a supported shape and turning the
   warning into a refusal would break it on upgrade.

## Consequences

- **Everyone signs in once a day.** That is the visible cost, and it is the
  point: the session was already bounded by the token's `ExpiresAt`, the server
  just did not enforce it. A deployment that wants the old behaviour sets
  `TABVERSED_SESSION_TTL=0`, and one that wants a different bound sets it.
- **The library's token refresh is dead code for us.** Its purpose was to keep a
  session alive past its own expiry, which is exactly what decision 1 stops.
  `ClaimsUpd` and the XSRF cookie are untouched.
- **A stolen cookie dies on its own** - at most `TABVERSED_SESSION_TTL` after it
  was issued - and an operator or the person themselves can end every session
  now. What it cannot do is name *which* browser had it: sessions are still
  stateless signed tokens and there is no session table, so "sign out everywhere"
  means everywhere, and "this device only" does not exist. That is the cost of
  choosing the hard cap over a sliding one with a session list.
- **Revocation is compared at second granularity**, so a session minted in the
  same second as a revocation survives it (`SessionRevocationWindow`). A login
  in the same second as a revocation is refused once and succeeds on retry.
- **Two sign-in links requested for the same address in the same second are the
  same link**, because the library's confirmation token carries no id of its own
  and only a second-resolution expiry. The second redemption is refused as a
  replay. That is the library's token construction, not this design.
- **The sign-in path gains a per-address budget**, so a person who asks for a
  link repeatedly has to wait. Five an hour is above any human.
- **`AuditLogin` for a social first sign-in has no account id yet**: the library's
  claim is keyed by the provider subject and the account row is created on the
  *next* request. The row is still written, with the claim id in the detail.