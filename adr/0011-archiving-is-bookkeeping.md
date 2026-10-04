# ADR 0011: archiving is bookkeeping, never deletion

Status: accepted (2026-09); revised: archiving a *device* is now the teardown
itself and is immediate, instead of a wait for silence. See "The revision"
below.

Extends [ADR 0009](0009-multi-tenant-and-server-console.md) (the admin API and
console) and the retention decision in
[ADR 0002](0002-privacy-posture.md).

## Context

Revoking a token (ADR 0009) answers "who can reach this account". It leaves the
console showing the consequences: a device with no usable token is still a row,
its token is still a row, and both still have the records they were attached
to. An operator cleaning up after a lost laptop sees them forever, and the
only ways to get rid of them today are the wrong ones - delete the account
(takes the user's real data with it) or edit the database by hand.

"Archive" is the obvious third verb, and it is also the easiest one to get
dangerously wrong, because in this schema **a record is not a log of what a
device did. It is the user's live data.**

`records` is the sync source of truth, one row per `(user, entity, id)`, and a
row carries the `device_id` of whichever device last wrote it. A tablet's
tabverses, notes and todos are the current state, replicated by delta sync to
every device the user owns. If archiving a record meant "this is gone", the
obvious implementation - tombstone it - would propagate through `rev` and
delete the user's tabverses on their laptop. Tidying up a dead phone would
destroy live data on the healthy one. That is not a trade-off worth offering,
so the semantics have to be chosen before the code, not after.

## Decision

**Archiving retires a row from the operator's views. It never touches the data.**

1. **Archived rows stay stored, stay synced, and stay the user's.** `archived_at`
   is a column on `devices`, `tokens` and `records`. A record with one set still
   travels the normal delta channel to the user's devices, and
   `GET /api/v1/search` (the extension's own search) does not filter on it.
   Archiving an operator's filing decision must not hide a tabverse from the
   user searching their own tabs.

2. **The console hides them by default.** The tabverse list, the record browser
   and the console's search all skip archived rows unless `?archived=1` is
   passed. The two views agree with each other, so a search can never surface a
   record the list beside it is hiding - an inconsistency that would read as a
   bug in the console.

3. **Revocation is a precondition, not a synonym.** Archiving a credential that
   still authenticates is refused with `409 not_revoked`: revoking is how access
   is cut, and archiving a live credential would hide from the console the very
   access that is still open. Unarchiving never re-enables anything - a
   revoked token stays revoked, and re-enabling is pairing again. *(For a
   device, the revision below makes archiving do the revoking itself.)*

4. **Devices additionally have to look abandoned.**
   `TABVERSED_DEVICE_INACTIVE_DAYS` (default 30) is the silence required, measured
   by the newest successful authentication of any of its tokens. A device that
   has *never* authenticated is exempt: it has no activity to wait out, and a
   mis-issued pairing code that was revoked straight away should not leave a
   phantom device in the list for a month. `0` disables the check. *(Removed by
   the revision below.)*

5. **Records a device wrote come back on their own.** Every accepted write clears
   `archived_at`, because a record somebody just changed is live again. Without
   this, archiving one device would permanently hide the user's tabverses for
   being edited on another.

6. **Tombstones are not restored by an unarchive.** Archiving never touched a
   deleted record, and undoing a delete is the client's business (ADR 0001) or
   the account's, not the operator's.

Removing user data is unchanged: a delete is a tombstone the client writes, or
deleting the account, which takes the records, the devices, the tokens and the
search index rows with it (ADR 0009).

## Consequences

- Cleaning up after a lost device is now a first-class operation: revoke its
  token, archive the device, archive what it last wrote, and the console is
  about the live account again - with every step reversible and none of them
  touching what the user's other devices hold.
- The console has a third state per row (live, revoked, archived) and the
  `?archived=1` flag, so "hidden" and "deleted" stop being the same idea in the
  UI. The badge is deliberately not a danger colour: nothing is lost.
- `archived_at` is an operator-side flag with no wire representation in the
  sync protocol. A client cannot see it, cannot set it, and is unaffected by it.
- The preconditions live in the store, not in the handler, so a future caller
  (a cron, a CLI) cannot bypass them by accident.
- An operator who archives records as a way of "tidying" and then wonders why
  the extension still has them has to read this ADR: archiving is a view, not a
  retention policy. The actual age-based pruning of `session` records is
  `TABVERSED_RETENTION_DAYS` (ADR 0001), and the only way an operator removes
  user data is to delete the account.

### The revision: archiving a device is the teardown, not a wait

The first version made archiving a *device* wait. It was refused while the
device still had a usable token (point 3), and again until the device had been
silent for `TABVERSED_DEVICE_INACTIVE_DAYS` (point 4). In practice that read as
the server refusing the operator's own decision - "still active: last synced
2d ago, needs 30 days of silence" - and it left a device that had just been
archived looking active, because revoking was a separate step the operator had
to remember first.

Archiving a device is now one deterministic, immediate, server-side action:

1. every token the device holds is revoked, so sync stops;
2. those tokens are archived;
3. the device is archived,

all in a single transaction. There is no inactivity window and no "revoke it
first" for a device: `TABVERSED_DEVICE_INACTIVE_DAYS` is gone, and
`ArchiveDevice` has no precondition beyond the device existing. Unarchiving
still only brings the device back - its tokens stay revoked and archived,
because unarchiving never re-enables access (point 3).

Archiving an individual *token* is unchanged: a live token is still refused
with `409 not_revoked`, since nothing revokes it for you. Archiving a device's
*records* still requires no usable token left on it, which archiving the device
satisfies.
