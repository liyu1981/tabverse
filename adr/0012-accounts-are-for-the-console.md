# ADR 0012: accounts are for the console, pairing is for the extension

Status: accepted (2026-09), phase 1 landed, phases 2-6 pending

Extends [ADR 0009](0009-multi-tenant-and-server-console.md) (the admin API and
console) and [ADR 0002](0002-privacy-posture.md) (no accounts, self-hosted).

## Context

The console exists to manage accounts, but there is no account: it is guarded by
one deployment-wide secret (`TABVERSED_ADMIN_TOKEN`) that either sees everything
or nothing. That answered the wrong question for a shared server. A person
cannot register, cannot see their own devices, and cannot add a device to their
own account without an operator minting a code first - so a self-hoster who
points `tabversed` at a second person has to reach for `curl` on the server.

The extension's side is not the problem and must not become one. It pairs, it
holds an opaque device token (ADR 0009), and a service worker cannot use cookies
while an extension has no business holding a password. Pairing is the right
credential for a device and stays exactly that.

So the account system is for the **web console**, and the first question is
whether to build it or adopt something.

### The library survey

| Candidate | State when checked | Why not |
| --------- | ------------------ | ------- |
| Better Auth | v1.7.6, published days ago, 30k stars, SQLite via Drizzle | TypeScript: a Node server beside the Go binary |
| Auth.js / `@auth/core` | 0.41.x stable, v5 experimental | same, plus an adapter for the storage |
| Ory Kratos | active | PostgreSQL / MySQL / CockroachDB, separate service |
| Zitadel | active | PostgreSQL 14+, separate service |
| Keycloak / Authentik | active | their own runtime and database |
| **Lucia** | **deprecated** (npm), last publish 2024 | the closest fit, now a migration guide |
| **go-pkgz/auth** | v2.3.0, MIT, actively developed, remark42's auth | adopted, with the caveats below |

Nothing else fits a single Go binary on SQLite. `go-pkgz/auth` does: pure Go,
`net/http` middleware (the server has no router dependency on purpose), v2 is
the actively developed line, and remark42's migration is the worked example of
running it at scale.

## Decision

**Pairing for the extension, accounts for the console, one library for the
protocol.**

1. **The extension is untouched.** It still pairs and still holds a device
   token. No password, no session, no OAuth in a browser extension.

2. **The console signs in with an account**, and a signed-in person manages
   their own account: mint their own pairing codes, list and revoke their own
   devices, browse their own data. This is the piece that removes the operator
   from the critical path.

3. **`go-pkgz/auth/v2` owns the solved parts**: the OAuth2 dance (GitHub, Google,
   Apple, Microsoft, and a fake provider for development), the JWT cookie, the
   XSRF echo, refresh, and the provider allow-list. We own everything about our
   data: the account row, the password hash, revocation, roles, and the audit log.

4. **Revocation is a cut-off, not a session table.** `users.tokens_valid_after`
   invalidates everything issued before it, checked by the library's `Validator`
   hook. There is no session table to grow, and "sign out everywhere" is one
   `UPDATE`. A password change bumps it; disabling an account does too.

5. **The claim id is the library's, the account id is ours.** The library's
   convention is `<provider>_<subject>` and its provider allow-list reads that
   prefix. `UserIDFunc` hands it our own user id as the subject at login, and
   one function - `accounts.ResolveAccountID` - bridges the two everywhere else.
   The pairing is made once, at sign-in; every later request is a primary key
   lookup.

6. **One address is one account.** A login whose verified address already has an
   account links to it. With `TABVERSED_LINK_BY_EMAIL=0` (for a deployment that
   cannot vouch for its providers) the login is *refused* with `ErrEmailTaken`
   rather than linked - and never given a second account, because a duplicate
   would be a way to end up with two accounts holding one person's data, one of
   which nobody is watching.

## What the spike found (phase 0)

Four questions, answered by reading the source and by tests that stay in the
tree as `internal/accounts/accounts_test.go`:

1. **Sessions are revocable.** `auth.Opts.Validator` is the hook; it is wired
   into the authenticator at `auth.go:107`, and it sees claims *before*
   `UpdateUser` rewrites them, so it resolves the account itself.

2. **XSRF covers our own routes.** The check is inside the extractor's `Get()`,
   not inside the library's login handlers, so any handler that resolves claims
   is protected - including every console route.

3. **Claims carry what we need.** `Opts.ClaimsUpd` sets the role, and is the
   place an assumed (impersonated) identity will go.

4. **The dependency costs ~10 MiB**, and not for the reason expected. The *dev*
   provider only adds ~283 KiB; the 10 MiB is `avatar`, which the top-level
   `auth` package imports unconditionally, and which imports `mongo-driver`,
   `bbolt` and `identicon`. We do not use avatars. A build that used only
   `token` + `middleware` and wrote its own login handlers would stay small, but
   it would also give up the library's social login, which is the reason we
   adopted it. Accepted, and recorded here so a future maintainer does not
   "optimise" it away by accident.

Four traps, each of which failed silently or confusingly first, all now encoded
in the code and its comments:

- **`UpdateUser` returns a middleware, it does not install one.**
  `mw.Auth(mw.UpdateUser(upd)(handler))`, or the claim is never rewritten and
  every request is refused with a bare 401.
- **A custom `ErrorHandler` replaces the response.** The library returns
  without writing a status, so a handler that only logs turns every refusal into
  a 200.
- **`IssuedAt` is stamped with `time.Unix(now, 0)`** by the library, so session
  tokens have no sub-second precision. Revocation is therefore compared at
  *second* granularity: it takes effect within a second, and a login in the same
  second as a revocation is refused once and succeeds on retry
  (`accounts.SessionRevocationWindow`). Setting the JWT library's global
  precision does not help, because the value has no nanoseconds to preserve.
- **The authenticator is a value.** Configure it once and reuse that instance.

## Consequences

- A person registers, signs in, and runs their own devices; an operator is only
  needed for the super-admin.
- The session model is stateless, so there is no session table to migrate, prune
  or grow - at the cost of the one-second revocation window above.
- Passwords and OAuth are ours to get right: Argon2id (64 MiB, three passes,
  parameters inside the hash so they can be raised later), a credential checker
  the library calls, and a rate limiter we still have to write.
- The deployment is ~10 MiB larger than it was, for reasons unrelated to
  avatars. A self-hoster who cares can build with only `token` + `middleware`.
- `docs/privacy` and the store disclosure both currently say there are no
  accounts. That stops being true in phase 2, and collecting an email address is
  a disclosure change, not a copy edit.
- Phases: 1 schema, 2 auth wiring and console login, 3 self-service pairing,
  4 social login (GitHub and Google; generic OIDC deliberately not wired) and
  5 impersonation all landed. Phase 6, the disclosure, is documented in
  `doc/tabverse-website/src/pages/privacy.md` and the store listing.
- `TABVERSED_ADMIN_TOKEN` did not survive phase 2: ADR 0013 removed it and
  replaced the bootstrap with `TABVERSED_ADMIN_EMAIL`, so the account system
  has no master credential behind it.
