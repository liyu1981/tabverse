# ADR 0015: deleting a tabverse from the console

Status: accepted (2026-09)

Extends [ADR 0009](0009-multi-tenant-and-server-console.md) (the admin API is
read only for user data), [ADR 0011](0011-archiving-is-bookkeeping.md)
(archiving is bookkeeping) and [ADR 0014](0014-console-is-a-directory-then-an-account.md)
(the console is an account at a time, and an assumed identity is read only).

## Context

The console grew a way to look at one tabverse: a row in the stored-data list,
and the bundle behind it. What it could not do was *remove* one.

Two reasons, and only the first one is the good one.

1. **There was nothing to delete.** Every data route under
   `/api/v1/admin/users/{user_id}/` was a `GET`. The extension has its own
   delete (`DELETE /api/v1/entities/{entity}/{id}`, tombstoning one record), but
   the console is not a device and has no device token, so it had no way to
   reach even that.
2. **And the honest reason it should stay that way.** ADR 0009 §"read only for
   user data" is not squeamishness: an edit from here carries no device and a
   clock the next honest sync would win against. Writing into `records` from
   outside the extension is a way to lose data.

But "an operator cannot remove one tabverse" has no answer when the content
itself is the problem - a tabverse full of somebody's medical pages, a client's
material nobody was ever meant to keep. Today the only options are deleting the
whole account (which takes every other tabverse with it) or editing SQLite by
hand. Neither is an answer; the second is not even available to most
deployments.

The delete is different from the edit, and the difference is the protocol: a
delete carries no payload for a device to win a comparison against. It carries
the opposite - a clock that wins. And it has to be a tombstone, for the reason
that has nothing to do with LWW at all: **removing the row from SQLite would
leave every paired device holding a copy, and the next push from any of them
would put it straight back.** A delete the server performs alone is not a
delete, it is a deletion at one point in a fan-out.

## Decision

**The console may delete one tabverse, by tombstoning it and everything that
hangs off it.**

1. **One route, and it is a delete:**
   `DELETE /api/v1/admin/users/{user_id}/tabspaces/{tabspace_id}`. It
   tombstones the tabverse record and every live record whose payload carries
   that `tabSpaceId`: tabs, notes, todos, bookmarks, closed tabs, and the three
   ordered aggregates (`allnote`, `alltodo`, `allbookmark`). Leaving the
   aggregates behind would leave orphaned orderings behind on every device.

2. **It is the extension's delete, widened.** `store.DeleteTabspace` collects
   the records and hands them to the same `ApplyRecords` the device route uses,
   so the tombstones, the `rev` assignment, the FTS removal and the
   `archived_at` reset are all the code that already runs for a user's own
   delete. There is no second implementation of "delete" to drift.

3. **The devices are told.** The handler publishes `records_changed` on the
   account's topic, so a paired browser removes its rows at the next debounced
   cycle instead of at its next poll. Without it the console would claim a
   tabverse is gone while a device still had it open.

4. **It asks for a typed confirmation,** exactly like deleting an account:
   `?confirm=<tabspace_id>`. A row in a list is one mis-click away from the
   wrong tabverse, and there is no trash.

5. **It is a write, so the assumed identity still cannot do it.** The
   `admin(...)` middleware refuses every mutating route while an operator is
   looking through somebody else's account (ADR 0014), and the console hides the
   button rather than letting the server be the only thing that says no.

6. **It is the only entry in the audit log that removed somebody's content,**
   so it has its own action (`tabspace_deleted`) rather than borrowing the
   credential lifecycle's. The detail names the tabverse and how many records
   went with it.

7. **LWW still decides.** A device that was offline when the delete happened
   and pushes its copy back with the clock it had loses to the tombstone. A
   device that genuinely edits the tabverse *later* wins, because its clock is
   newer - that is what last-write-wins means, and the answer is to delete
   again. This is stated rather than worked around: a delete in a replicated
   store cannot promise the future.

## Consequences

- The console's tabverse view is a drawer over the account rather than a page
  that replaces it, because the delete is a decision made *about* something in
  the list you were reading. Losing the list to look, and losing it again to
  come back, is how the wrong row gets deleted.
- The extension's action buttons ("Load to New Window", "Switch to Tabverse")
  are deliberately absent from that drawer: they act on the browser the console
  is running in, and a tab stored on this account is not openable here.
- ADR 0011 stands. Archiving still hides a row from the operator's views and
  keeps it stored; archiving is not a smaller delete, and a delete still
  includes archived rows (they are stored data that belongs to that tabverse).
- `GetTabspaceBundle` answers 404 for a tombstoned tabverse: the console asked
  for a view of something that is gone, and a nameless tabverse would be a lie.
- The record browser needed a fix to survive this: `json_extract()` raises on a
  tombstone's empty payload, so asking it for a deleted tabverse's rows was a
  500. The extraction is guarded now.