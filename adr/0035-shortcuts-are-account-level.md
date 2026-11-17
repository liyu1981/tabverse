# ADR 0035: shortcuts are account-level records, and a logo is bytes

Status: **accepted (2026-11)**. Extension and server. Plan:
[`doc/tabverse-shortcuts-plan.md`](../doc/tabverse-shortcuts-plan.md). Extends
[ADR 0001](0001-server-authoritative-sync.md) (the record stream) and follows
[ADR 0002](0002-privacy-posture.md) (what leaves the machine) and
[ADR 0016](0016-tab-previews-are-a-cache.md) (a tab picture is a local cache).

## Context

Bookmarks are per-tabverse: a row carries `tabSpaceId`, a per-tabverse
`SavedAllBookmark` aggregate carries its order, and it is part of the tabverse's
bundle, export and cascade delete. That is right for "the pages this piece of
work needed", and wrong for "the twelve web tools I open every day": saving one
of those in every tabverse would be the same page, twelve times, in twelve
private lists.

The person asked for a Launchpad - a grid of large icons, reachable from every
tabverse, with the site's own logo rather than a 16px favicon. Four places
should be able to add a page (a tab, a Bookmark, the History tool, and the
toolbar popup), so the page itself needs no "new shortcut" form. It should be
available without a server and identical on every paired browser.

The two questions that decide the shape are where a shortcut lives in the data
model, and what a logo is.

## Decision

1. **A shortcut is an account-level record, not a tabverse child.** The entity
   is `shortcut`; the table is `SavedShortcut`; the row has `name`, `url`,
   `iconDataUrl`, `iconUrl`, `favIconUrl` and `IBase`, and **no `tabSpaceId`**
   and no ordering aggregate. It is not in `tabspaceEntities`, not in a
   tabverse's bundle, export or delete, and not in `.tabverse` files. The route
   is `launchpad`; the page is the Launchpad and the row is a shortcut.

   Being outside those rules is the feature. A "global" flag on a Bookmark
   would make every one of them (`where('tabSpaceId')`, the aggregate, the
   bundle, the cascade, the export) remember to special-case one row, and a
   missed special case is a shortcut deleted with a tabverse it has nothing to
   do with.

2. **It syncs on the existing account pairing.** No new toggle, no second sync
   mode, no separate settings stream: adding the entity to `EntityName`, the
   `dbBridge` binding and the server's allowlist puts it on the same outbox,
   push, pull and console surface as every other record. A change feed hook
   queues it, and the worker's pull writes it back. The account's record stream
   is the only source of truth, and a paired device sees the same Launchpad.

3. **A logo is bytes.** On an add, the page's icon links are read (an injected
   `apple-touch-icon` / sized `<link rel=icon>` lookup), the best one is fetched
   once with no credentials, decoded, drawn "contain" at no more than 128px,
   and re-encoded as PNG into `iconDataUrl` (capped at 48k characters of data
   url, retried at 64px). The bytes are stored in the record and synced, so a
   tile survives a site that blocks hotlinking, deletes its icon, or is offline
   on the device the Launchpad is opened on. `iconUrl` (the source) and
   `favIconUrl` (the tab's own icon) are the fallback chain; a monogram drawn
   locally, on a colour hashed from the host, is the last one. No third-party
   placeholder host is contacted.

   This is a deliberate difference from ADR 0016's thumbnails. A tab thumbnail
   is a picture of the person's screen, is worthless once the tab is gone, and
   must never leave the machine; a site's icon is public, small after the
   encode, and is the one thing that makes a Launchpad work on a second device
   without a network. The bytes are a record field, not a cache: losing them
   would lose the tile's identity, not a stale copy.

4. **Adding is idempotent by normalized url within one profile.** Re-adding a
   page keeps the existing row (and its possibly edited name) and reports
   "Already in Launchpad"; the only update is filling an empty icon. Duplicate
   rows created on two devices before either synced are allowed in v1 and are
   the person's to delete: merging them needs a name-conflict policy and
   tombstones for the loser, which is a feature of its own.

5. **The Launchpad is local-first.** It is a manager route that works with no
   server; sync is optional like everywhere else. The filter and the
   alphabetical/newest-first order are window-local UI state (localStorage), not
   records: two devices on one account may reasonably want different orders.

## Consequences

- A new Dexie table and a DB version bump (11 -> 12), without a data migration:
  a pre-v12 build ignores the table, and the new one starts empty.
- The server's allowlist grows by one entity, and its FTS index deliberately
  does not: the extension's search returns tabverses, and a shortcut has none.
  `iconDataUrl` joins `nonContentKeys` so a base64 image never reaches a snippet
  or an index body.
- Old and new builds are compatible in one direction only. An old client
  ignores pulled shortcuts (no table) and never sends one. A new client that
  pushes a shortcut to an older `tabversed` gets the whole batch rejected
  (`unknown entity`), so the release note is "upgrade the server first"; the
  outbox keeps the entries and flushes them after the upgrade.
- A shortcut with an icon is roughly 8-20 KB of payload, so a hundred of them
  is a couple of megabytes on the first upload. The cap and the 128px encode
  are what keep that bounded; a larger icon would buy a slightly crisper tile
  at several times the cost.
- Two shortcuts to the same site each store their own copy of the icon. That is
  the price of a self-contained row, and the cap keeps it honest; de-duplicating
  icon bytes would add a second table and a second thing to keep in step.
