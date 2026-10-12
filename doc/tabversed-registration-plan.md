# Plan: registration invites, and a social-only official build

Status: **plan** (2026-10). Server + console. Follows accounts (`adr/0012`,
`adr/0013`), the operator surface (`adr/0009`, `adr/0014`) and the official
flavour (`adr/0024`). One new table and one new build default, so it wants a
short ADR of its own (the next free number; the share plan in
`doc/tabverse-share-tabverse-plan.md` also proposes one).

## 0. What is being asked

1. A config, **`need_invitation_for_registering`** (env
   `TABVERSED_REGISTRATION_REQUIRES_INVITE`): when on, an account can only be
   **created** for an address the operator has **invited**. An existing account
   signs in as before.
2. For the **official build**, turn the email path off entirely: no sign-in
   link, no email form - **social logins only**.

## 1. Where we are (grounded)

- **There is no "register"**. A person signs in, and *asking for the link
  creates the account*: the console posts to
  `POST /console/api/v1/console/signin-link?address=…&user=…`, and
  `handleConsoleSigninLink` (`internal/api/console.go:221`) throttles, calls
  `Service.EnsureAccount`, then hands the request to the library's
  `/email/login`, which sends the link.
- **One place creates accounts.** `Store.UpsertIdentity`
  (`internal/store/accounts.go:375`) is the single writer: the email path
  reaches it through `EnsureAccount` (`accounts/service.go:796`), and a social
  login reaches it from the session resolver (`accounts/service.go:403-412`)
  when the claim does not resolve to an account. It returns
  `(userID, created, err)`.
- **The operator already invites - for pairing.** The `invites` table
  (`internal/store/store.go:139`) is a **single-use device-pairing code** bound
  to a `user_id`; it is not an account invitation and must not be reused for
  one.
- **The console already reports what it can offer.** `GET …/console/me`
  returns `providers` (`Config.SocialProviders`) and `smtp`
  (`Config.SMTPConfigured`), and `SignInView` (`server/ui/views/SignInView.tsx`)
  draws the social buttons and the address form from them.
- **The official flag is build-time, and Go does not read it.** `officialserver=1`
  is read by `tools/embedsite.sh` and the Docusaurus config, "never by Go"
  (`adr/0024`). Point 2 changes that, deliberately, and the ADR should say so.

## 2. Decisions

| # | Question | Decision |
|---|----------|----------|
| D1 | What is an invitation? | A row keyed by **email** (lower-cased): the operator names an address, and registration with it is allowed until it is used or expires. An **optional code** (`code_hash`) can also be required; default is email-only, because the operator naming the address is already the gate. |
| D2 | Who may invite? | An **operator** only (`s.adminOnly`), from the Admin tab - the same people who can already create pairing codes and impersonate. |
| D3 | Where is it enforced? | At **account creation**, not sign-in: `UpsertIdentity` returns `created`; when it would create and `RegistrationRequiresInvite` is on, a live invite for that email must exist. An existing account is never blocked. |
| D4 | Does the code travel? | For the **email** flow the form can carry an optional code (`address` + `code`); for **social** the address is the gate (the provider proves it), so a code is not required there. |
| D5 | When is an invite spent? | When the account is created (the link request for email, the first callback for social), in the **same transaction** as the insert, so a crash cannot both create the account and leave the invite reusable. |
| D6 | Email off on the official build | `TABVERSED_EMAIL_REGISTRATION` (default `true`); the official flavour flips the **default** to `false` with a Go build tag, and the runtime env can override either way. |
| D7 | What does "off" mean? | `handleConsoleSigninLink` answers `403 email_registration_disabled`, and `me.email_registration=false` makes `SignInView` draw only the social buttons. The route stays registered, so an old page gets a clear refusal instead of a 404. |
| D8 | Refusal shape | A refused registration is a `403 invite_required` (or `email_registration_disabled`) with a message a person can act on ("this server is invite-only; ask the operator to invite your address"). It says nothing about whether the address already has an account. |

## 3. The invitation

A new central table (`internal/store/store.go`, beside `invites`):

```sql
CREATE TABLE IF NOT EXISTS registration_invites (
  email      TEXT PRIMARY KEY,        -- lower-cased, the gate
  code_hash  TEXT NOT NULL DEFAULT '',-- sha256 of the code, '' = no code required
  invited_by TEXT NOT NULL,           -- the operator's user_id
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,        -- 0 = no expiry
  used_at    INTEGER                  -- set when the account is created
);
CREATE INDEX IF NOT EXISTS registration_invites_live
  ON registration_invites(used_at, expires_at);
```

`email` is the key: re-inviting an address refreshes the row (a new code, a new
expiry) rather than stacking rows. It is deliberately **separate from
`invites`**: that one is a pairing code bound to an account, this one is an
account that does not exist yet.

### Admin API (operator only)

| method | path | body / result |
|---|---|---|
| `POST` | `/console/api/v1/admin/registration-invites` | `{email, ttl_seconds?, with_code?, send_email?}` → `{invite, email: {subject, body}}` (the code and the rendered email are returned once) |
| `GET` | `/console/api/v1/admin/registration-invites` | the list: pending, used, expired |
| `POST` | `/console/api/v1/admin/registration-invites/{email}/send` | re-send the invitation email → `204` |
| `DELETE` | `/console/api/v1/admin/registration-invites/{email}` | revoke |

### The invitation email

The operator gets the invitation in **two** forms, because not every deployment
has SMTP:

- **Sent by the server** when `send_email` is set (or a re-send is asked for),
  through the same `accounts` sender the sign-in link uses. This is the default
  when SMTP is configured.
- **Copied by the operator** otherwise. The rendered `{subject, body}` is part
  of the create/send response, so the console can show it in a small dialog with
  a **Copy** button and the person pastes it into their own mail client.

The text lives in **one** place, Go (`accounts/registration_invite.go`,
`registrationInviteEmail(publicURL, code, expiresAt)`), and the console only
echoes what the server rendered - a template written twice is a template that
drifts. It names the server and its console URL, carries the code when there is
one, and says the invite is for that address and expires.

## 4. Enforcement

One check, used by both doors:

```go
// Service.registrationAllowed reports whether an account may be created for
// this address right now. Always true when RegistrationRequiresInvite is off.
func (s *Service) registrationAllowed(ctx context.Context, email, code string) (bool, error)
```

- **Email** (`handleConsoleSigninLink`): after the throttle, look the account up
  by address. It exists → the library sends the link as today. It does not → if
  `registrationAllowed(email, code)` is false, answer `403 invite_required`
  before `EnsureAccount` runs.
- **Social** (the resolver, `accounts/service.go:403-412`): the session resolves
  to no account → if the claim carries an email and
  `registrationAllowed(email, "")` is false, refuse the session and do not
  create the account. (A provider that returns no address - GitHub today - is
  already refused by `RequireEmailVerification`; the invite check sits in front
  of it.)

`UpsertIdentity` gains the atomic half: when it is about to insert and the
policy requires an invite, it checks and marks the invite used inside the same
transaction, returning `ErrInviteRequired` otherwise. That keeps D5 true and
means there is no window where two registrations both pass the check.

## 5. The official flavour: social only

- **Config**: `EmailRegistration bool` (env `TABVERSED_EMAIL_REGISTRATION`,
  default `true`).
- **Build default**: a Go build tag `officialserver` (a small
  `internal/config/official_defaults.go` with `//go:build officialserver`) sets
  the default to `false`. `pnpm run server:build` passes `-tags officialserver`
  when `officialserver=1`, and the CI `server-official` job does the same.
- **Runtime override** stays: `TABVERSED_EMAIL_REGISTRATION=1` turns it back on
  for a one-off, and a self-hosted build can set `=0` without the tag.
- **Console**: `me.email_registration` (new field, next to `smtp`/`providers`).
  `SignInView` draws the form only when it is true, and says so when it is
  false ("sign in with Google or GitHub"). If it is false **and** no social
  provider is configured, the server logs a loud warning at startup - that is a
  deployment nobody can sign in to.
- **`adr/0024` note**: the flag now reaches Go, through a build tag rather than
  the site embed. The ADR gets a line, or the new ADR records it.

## 6. Server work

1. `internal/store/registration_invites.go` - create/list/revoke, and
   `consumeRegistrationInviteTx` for the atomic half; `ErrInviteRequired`.
2. `internal/store/store.go` - the table + index.
3. `internal/store/accounts.go` - `UpsertIdentity` takes the registration policy
   and enforces it in the insert transaction.
4. `internal/accounts/service.go` - `registrationAllowed`, and the resolver's
   check before `UpsertIdentity`.
5. `internal/api/console.go` - `handleConsoleSigninLink` refuses when the
   address is not invited, and when email registration is off; `me` gains
   `email_registration`.
6. `internal/api/admin.go` - the four operator routes (create, list, send,
   revoke), audited (`registration_invite_added` / `_sent` / `_revoked`).
7. `internal/config/config.go` - `RegistrationRequiresInvite`,
   `EmailRegistration`, and the `officialserver` default file.
8. `internal/accounts/registration_invite.go` - the email template
   (`registrationInviteEmail`) and sending it through the existing sender.
9. `api/openapi.yaml` - the four routes and the `email_registration` field.
10. `internal/accounts/logger.go` / startup - the "no way in" warning of §5.

## 7. Console work

1. `server/ui/data/types.ts` - `RegistrationInvite`, and `email_registration` on
   `Me`.
2. `server/ui/data/api.ts` - `inviteRegistration(email, ttl)`,
   `listRegistrationInvites()`, `revokeRegistrationInvite(email)`.
3. `server/ui/views/SignInView.tsx` - hide the address form when
   `me.email_registration` is false (social only); when a link request is
   refused, say the server is invite-only. Add the optional code field only when
   the invite requires one (D4).
4. `server/ui/views/AdminPanel.tsx` - a **Registration invites** section that
   manages the whole life of an invite:
   - a create form: an address, a lifetime, "require a code", "send the email";
   - a table of pending / used / expired invites (address, when it was invited,
     when it expires, whether it has a code);
   - per row: **Copy email** (the server-rendered subject and body, with a copy
     button), **Resend**, **Revoke**;
   - after a create or a resend, a status line saying whether the mail went out,
     or that there is no mail server so the template is the thing to copy.

## 8. Testing

- **Go**: store - invite create/refresh/revoke, consume-once, expiry;
  `UpsertIdentity` refuses without an invite and succeeds with one (and never
  blocks an existing account); `handleConsoleSigninLink` - invited, not
  invited, email off; the resolver refuses a social first-login without an
  invite; the config default under the `officialserver` tag. `go test -race`.
- **Console**: `SignInView` markup with `email_registration` true/false and with
  a refusal; the admin invites section (list states, copy, revoke);
  `api.test.ts` for the four calls.
- No new browser work: `renderToStaticMarkup`, per `AGENTS.md`.

## 9. Work items, in order

1. **A new ADR** - invite-gated registration, and the official flavour's email
   default; note the `adr/0024` extension.
2. **Store** - the table, the invite access, the atomic consume, and
   `UpsertIdentity`'s policy; tests.
3. **Service + API** - `registrationAllowed`, the two enforcement points, the
   config, the three admin routes, `me.email_registration`; tests.
4. **Official default** - the build tag, the `server:build` and CI wiring.
5. **Console** - the sign-in view, the admin invites section.
6. **Docs** - `server/README.md` (the two variables and the official default),
   and the manual's "Self-host a server" note that a self-hosted server is open
   by default.

## 10. Files

| Path | What |
|---|---|
| `doc/tabversed-registration-plan.md` | this plan |
| `adr/00NN-…` | the decision record |
| `server/internal/store/registration_invites.go` | the invite table access |
| `server/internal/store/store.go` | the table + index |
| `server/internal/store/accounts.go` | `UpsertIdentity`'s policy + atomic consume |
| `server/internal/accounts/service.go` | `registrationAllowed`, the resolver check |
| `server/internal/api/console.go` | signin-link refusal, `me.email_registration` |
| `server/internal/api/admin.go` | the three operator routes |
| `server/internal/config/config.go` (+ `official_defaults.go`) | the two settings |
| `server/ui/views/SignInView.tsx` | social-only when email is off; invite refusal |
| `server/ui/views/AdminPanel.tsx` | the invites section |

## 11. Open questions

- **Code or no code?** This plan makes the code optional (D1/D4): an operator
  naming the address is the gate, and a code is one more thing to paste. If a
  code should be mandatory, it is a `with_code` default and one extra field on
  the form.
- **Does the official flavour want *any* escape hatch** (an env that turns email
  back on), or should social-only be absolute there? This plan keeps the env
  override; making it absolute is a one-line removal.
- **Invite expiry**: default `0` (no expiry) or, say, 7 days? Leaning 7 days for
  a pending invite, since it is a one-time grant.
- **Re-inviting a used address** should be allowed (the account exists, so it is
  a no-op sign-in anyway), but the operator UI should show it as used rather
  than silently refresh.
