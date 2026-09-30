# ADR 0014: operator powers are a fourth tab

Status: accepted (2026-09), revised the same day after it shipped: the first
version of this decision made the operator land on the directory, which took
their own account away from them. See "The revision" below.

Extends [ADR 0012](0012-accounts-are-for-the-console.md) and
[ADR 0013](0013-no-master-credential.md), which made the console per-account
but did not say what an operator should *see* when they are not looking at one.

## Context

ADR 0012 and 0013 gave the console a session, an operator role and a
read-only assumed identity. What they left in place was the shape the token-era
console had: an accounts sidebar on the left (a list, plus a create form) and the
account's three tabs on the right, with the operator landing directly in *their
own* account's data.

That is wrong for the person the roles were built for. Three problems, in
increasing order of how long they took to notice:

1. **The list was in two places.** The sidebar and the content area were both
   about accounts, and a person - who has exactly one account - got a list of
   one, which is not navigation, it is a row.
2. **The operator's first screen was their own tabverses.** Having just been
   handed the ability to see everybody's accounts, the first thing the console
   showed them was their own. The operator's actual job is "who is on this
   server, and what do I do about them", and that was nowhere on screen.
3. **Operator powers were spread across both places.** "Look as them" lived in
   the sidebar; rename, delete and (from the token era) "create account" lived in
   the account header. The two halves of one set of powers, in two panes, with
   the destructive one next to the benign one.

And one thing was simply wrong rather than merely awkward: **"create account"
for an operator.** An account is an address and a proof that the person controls
it. An operator creating one could only ever create an account with no address -
or with someone else's - and would have to mail the link out by hand. It is the
one operation in the console whose result nobody can use, and it existed because
it was there before registration did.

## Decision

**The account view is the console, and an operator gets a fourth tab.**

1. **Everybody lands on their own account**, with the three tabs they have
   always had: Pair Code, Devices & Tokens, Stored data. An operator is not a
   special case here - their own tabverses, devices and pairing codes are one
   click away, exactly like anybody else's, because they own an account too.
2. **An operator's powers are a fourth tab, "Admin"**: the accounts, and per
   row *Impersonate*, *Make/Remove operator* and *Delete*. It is a tab rather
   than a separate page precisely so the three account tabs never go away.
3. **Impersonating switches the three account tabs to that account**, read-only,
   titled `alice (impersonated by admin)` in the account header and not only in
   the banner, because a screenshot or a "what did you see" question has to
   carry the answer with it. The Admin tab stays available, so looking at
   somebody else is one click and coming back is *Stop looking*.
4. **There is no "create account" anywhere, and no accounts sidebar.** An account
   is an address and a proof that the person controls it; an operator could only
   ever create one nobody can prove, and would have to mail the link out by
   hand. The sidebar was a second copy of the directory for an operator and a
   single useless row for a person.
5. Owner powers (rename, delete, delete-my-account) stay with the account; they
   are hidden rather than offered-and-refused while an operator is looking
   through it.

### The revision

The first version of this ADR said the console had three landing states: an
operator got the directory, an operator looking at somebody got that account,
anybody else got their own. It was tidier on paper and wrong in a way only a
person could find: **an operator could not open their own account at all.** Their
row in the directory said "this is you" and offered nothing, so there was no
path to their own tabverses, their own pairing codes, or adding a device to
their own account - a self-hoster who was also the operator had lost the console
they had been using minutes earlier.

The directory was not the problem; making it *replace* the account view was. An
operator is an account that can also do more, not a different kind of account,
and the fix is to give them one more tab rather than one fewer page.

## Consequences

- Signing in as an operator shows your own account, as it always did, with a
  fourth tab for the accounts. Nothing an operator used before is gone.
- The directory needs data the old account list did not carry - the address and
  the role - or a row is an opaque id and "who is the other operator" has no
  answer, so `GET /api/v1/admin/users` grew both plus a `?q=` filter, since a
  list of accounts is unusable without a filter.
- Removing the create endpoint removes the last way to make an account with no
  address, which is what "one address, one account" needed to be structural
  rather than aspirational.
- An operator cannot delete their own account: it would leave the deployment
  with no way back in, the same rule that already stopped them demoting the last
  operator. A person *can* delete their own, which is the ordinary expectation
  of an account system - and after it, the console has nothing left to show, so
  it returns to the sign-in form rather than to an empty page.
- The impersonation rules are unchanged: read-only, time-boxed, audited in both
  directions, and operators cannot look through other operators - the directory
  does not even offer the button.
- Both the operator's account view and the directory are covered by tests that
  run the real script against the real page, so "can this person reach their own
  account" is now a checked question rather than a thing to notice.
