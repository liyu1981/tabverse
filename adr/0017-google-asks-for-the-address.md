# ADR 0017: Google asks for the address, and Google's word proves it

Status: accepted (2026-10)

Extends [ADR 0012](0012-accounts-are-for-the-console.md) (accounts exist so the
console has no master credential). It is the follow-up to two fixes that were
made in the same area: the `/auth` routing path missing from the provider
redirect URI, and `Service.withConsoleReturn` putting the console on every
sign-in's `?from=`.

## Context

The console's account *is* an address. `TABVERSED_ADMIN_EMAIL` is matched against
it to make the first registration the operator, `TABVERSED_LINK_BY_EMAIL` merges
a social login with an existing account by it, and
`TABVERSED_REQUIRE_EMAIL_VERIFICATION` (default **true**) refuses a session for an
account nobody has proved.

The auth library registers Google with `svc.AddProvider("google", …)`, whose
built-in preset asks for **one** scope - `userinfo.profile` - and maps only the
id, the name and the picture out of Google's userinfo document. So the account a
Google sign-in produced had **no address at all**, and every one of these
consequences followed from that:

- with the default settings, the session was refused on every request - the
  person signed in correctly and was then signed straight out;
- `TABVERSED_ADMIN_EMAIL` could never match, because there was no address to
  match, so a Google-only deployment could not get an operator at all;
- and because `users.email` carries a **unique index**, two Google users collided
  on the empty string, so the second one could not register at all. This is not
  a single-user deployment's problem.

The library offers no way to add a scope to a preset: `AddProvider(name, …)`
dispatches on the name, and the OAuth2 handler's scopes are fixed inside
`provider.NewGoogle`. There is a supported route past it -
`AddCustomProvider` with our own `MapUserFn` and scopes - which is plain OAuth2
against Google's own userinfo document, not a made-up userinfo shape.

## Decision

**Google is registered as a custom provider asking for `profile email`, and a
provider that reports the address as verified has proved it.**

1. **Two scopes.** `userinfo.profile` and `userinfo.email`, so Google's v3
   userinfo returns `email` and `email_verified`. Same endpoints as the library's
   own preset (`google.Endpoint`, the same userinfo URL), so the redirect URI
   registered in Google's console does not change.

2. **`sub`, hashed and prefixed.** The mapping uses `sub` (Google's OAuth
   userinfo has no `id`) and produces `google_<hash>`, which is both how the
   account layer knows which provider a claim came from and what keeps two
   providers from colliding. A document with **no** subject maps to no id at all:
   the hash of an empty string is the same for everybody, so that would hand
   every such login one account.

3. **`email_verified` is proof.** Google's own statement that the address is
   verified is recorded on the claim (`email_verified` attribute), and the
   account updater treats it exactly like following an emailed sign-in link:
   the address was received at an address the person controls. Both paths write
   the same audit entry, with the reason spelled out.

4. **A provider that says nothing is still not trusted.** The library's GitHub
   preset returns no verified address, so a GitHub login leaves the account
   unproven and is refused under the default settings. That is the honest
   outcome, and it is unchanged: the address exists, nobody vouched for it, and
   the account can be proved by following a sign-in link to it.

5. **`TABVERSED_LINK_BY_EMAIL` keeps its meaning.** Now that Google supplies an
   address, the setting decides something real: whether a Google sign-in whose
   address already has an account is merged into that account or refused.

## Consequences

- The consent screen now asks for the address, and somebody who already granted
  `userinfo.profile` is asked once more. Both scopes are basic profile scopes -
  no app verification needed for them, unlike the restricted ones.
- `TABVERSED_REQUIRE_EMAIL_VERIFICATION=true` is now the *right* default for a
  Google deployment rather than a wall.
- A Google-only deployment can have an operator: the address reaches the account,
  so `TABVERSED_ADMIN_EMAIL` matches.
- GitHub sign-in still needs `TABVERSED_REQUIRE_EMAIL_VERIFICATION=false` (and,
  for more than one person, a provider that returns an address at all). Left
  alone deliberately: it needs GitHub's `/user/emails` lookup and a decision
  about which address is primary.
- `golang.org/x/oauth2` moves from an indirect to a direct requirement, for
  `google.Endpoint` - hand-writing Google's two URLs would be the alternative,
  and drifting from them is the worse of the two.