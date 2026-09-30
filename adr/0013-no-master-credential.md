# ADR 0013: the console has no master credential

Status: accepted (2026-09), supersedes the operator token of
[ADR 0009](0009-multi-tenant-and-server-console.md)

## Context

ADR 0009 gave the console one deployment-wide secret,
`TABVERSED_ADMIN_TOKEN`. It worked, and it was wrong in three ways.

**It was the wrong kind of secret to hand out.** It was one value that saw every
account, minted pairing codes for anyone and read everyone's tabverses, and it
lived in an environment variable, a shell history and a password manager. For a
self-hosted server whose whole promise is "the data is yours and only yours"
(ADR 0002 §5), the operator credential was the single place where that stopped
being true of the *console*: one holder, total access, no attribution. The audit
log ADR 0012 introduced could name an account, and then the main way into the
console could not - the token authenticated nobody, so every action taken through
it was unattributed.

**It answered a question nobody was asking.** The workflow people actually have
is "add a laptop", and with only a token that meant an operator minting a code for
them. The account system ADR 0012 built removes the operator from that path
entirely, which left the token guarding views that signed-in people can now reach
themselves.

**It had a failure mode with no floor.** A deployment that lost the token had no
way back in: no second factor, no recovery, no other credential. Meanwhile
`handleBootstrap` had grown a special case where the token was *also* required,
so the deployment had two secrets and one recovery path, and neither was a
person.

There was also the deadlock ADR 0012 left open: the only route to the operator
role was an endpoint that itself required an operator.

## Decision

**The console has exactly one credential, and it is an account.**

1. **`TABVERSED_ADMIN_TOKEN` is gone**, along with the token form in the console,
   the bearer fallback in the middleware, the `?access_token=` acceptance for
   console routes, and the bootstrap special case. There is no "console disabled"
   state any more either, because there is nothing to disable: accounts are
   unconditional, so `api.New` builds the account layer itself rather than
   accepting one, and the nil checks that state required are gone with it.

2. **The refusals collapse to two answers.** 401 when nobody is signed in (sign
   in) and 403 when somebody is, and this view is not for their role. The 404
   "console disabled" existed only because a token could be absent; nothing else
   needs distinguishing.

3. **`TABVERSED_ADMIN_EMAIL` makes the first operator.** The first account
   registered with that address is promoted, if no operator exists yet - and the
   same check runs at startup, so a deployment that registered first and set the
   variable afterwards is promoted by a restart. Once an operator exists the
   variable grants nothing, which is what keeps a stale setting from minting
   operators later. There is no secret to copy anywhere: the person registers
   with an address and is the operator.

4. **A registration adopts a lone pre-account user.** A deployment from before
   accounts has sync users with no address. The first registration takes over that
   row if there is exactly one, keeping its id, so the records already synced
   stay attached instead of being orphaned on an account nobody can see. With
   several, nothing is adopted - guessing would hand one person another person's
   browsing history - and the server says so in the log.

5. **Lockout is the database, and that is acceptable.** An operator who loses
   access to their own address can set the role in the SQLite file, which is the
   same file that holds every payload in plaintext (ADR 0002 §1). A backdoor that
   works without filesystem access would be a worse trade than a documented
   procedure for a self-hosted server. It is written down in the README.

6. **The bootstrap endpoint closes earlier than it used to.** It is refused once
   this deployment has a user *or* an account, so an exposed port has a shorter
   window than the "no users yet" rule, and registration in the console is the
   ordinary way in from then on.

## Consequences

- **Every console action is attributable to an account**, which is the whole
  point of having an `audit_log`.
- **An operator is a person, not a deployment.** They can be added and removed
  per account, and the last one cannot be demoted or disabled.
- **The console has no bearer credential at all**, so the extension's device
  token and the console's session cannot be confused for one another - there is
  a test that says so.
- **Upgrading is one variable.** Set `TABVERSED_ADMIN_EMAIL`, restart, register
  with it. Anything the token could reach, that account can reach. The extension
  is untouched: it pairs with a device token exactly as before.
- **The admin token was the only break-glass path**, and it is gone. A deployment
  that locked itself out now needs the database; the README says so, and the
  startup log names the operator situation on every boot.
- Pairing keeps the ADR 0002 posture that mattered: the extension never holds a
  password, a session, or a cookie, and its credential is still a device token
  that an operator can revoke per device.
