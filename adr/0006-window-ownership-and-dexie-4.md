# ADR 0006: one tabverse per window, Dexie 4 without dexie-observable

Status: accepted (2026-09)

Supersedes the "the tabSpaceRegistry leader election stays" section of
[ADR 0004](0004-strictness-react19-tiptap.md).

Partly revisited by the toolbar popup (`doc/tabverse-popup-plan.md`): the
manager page still only ever knows its own window, but the popup lists the
tabverses open in *all* windows and can switch to one. It can afford that
because it answers the question with one `chrome.tabs.query({})` and the
`tvid` every manager page carries in its url, with no state to keep
consistent - the leader election the old registry needed is what this
avoids, not the ability to see another window.

## Context

Two facts about the extension had been carried for a long time:

1. `tabSpaceRegistry` (791 LOC: leader election, attendee protocol, state
   machine, store) existed only to answer _"which tabverses are open in which
   other browser window"_, so the manager page could list them and switch to
   them. ADR 0001 predicted the server would make this unnecessary; ADR 0004
   reversed that, on the grounds that the registry tracks browser-local
   presence that the server never sees.
2. The sync change feed was built on **dexie-observable**, a `Dexie.Observable`
   addon whose `db.on('changes')` event reports writes from every context
   through a BroadcastChannel. The installed version was `3.0.0-beta.11`; the
   newest published line (`4.0.1-beta.13`) stopped in January 2023 and its peer
   range only covers Dexie 4 _alpha_, so a Dexie 4 upgrade was blocked by it.

Meanwhile the real cross-window story was fragile: the service worker had to ask
the other windows' manager pages which tabspace owned a tab
(`BackgroundMsg.GetTabSpace`), and an unanswered request either threw away a
whole session snapshot or (with no server paired) had no way to resolve at all.
Users had reported exactly that failure.

## Decision

**Each Tabverse manager page owns exactly one Chrome window, and nothing else.**

1. **Cross-window switching is removed as a feature.** The "In Other Windows"
   sidebar group is gone, `switchToTabSpace` only acts on this window's own
   tabverse, and `tabSpaceRegistry` (with the `broadcast-channel` dependency) is
   deleted. The user-visible cost: someone with Tabverse open in two windows can
   no longer jump between them from the UI. They can still open a saved
   tabverse in a new window (`restoreSavedTabSpaceUtil`).
2. **No window→tabspace registry, in memory or persisted.** A manager page does
   not advertise itself anywhere. The service worker therefore cannot attribute
   a Tabverse tab to a tabspace when it snapshots the browser, so it records
   every tab - manager pages included - as a plain tab of its window. The
   `tabSpaceTabId`/`tabSpaceId` fields stay in the session payload so snapshots
   written by earlier versions still restore.
3. **The change feed uses Dexie's own write hooks** (`Table.hook('creating' |
'updating' | 'deleting')`), which fire in the context that performed the
   write. That is all sync needs, because every context now owns its own rows
   and reports them itself. `dexie-observable` and its BroadcastChannel are
   deleted; `broadcast-channel` goes with them.
4. **Dexie 4.4.6.** The version bump is the point of the change: with the addon
   gone there is nothing pinning us to Dexie 3.
5. **Cross-context UI notification is explicit.** The one thing the addon's
   cross-context event was still needed for - telling a manager page that the
   _service worker_ wrote (session snapshots, records the engine pulled) - is
   now a `BackgroundMsg.LocalTablesChanged` runtime message that
   `message/chromeMessage` re-publishes locally. Payload is table names, not row
   diffs; listeners re-query.
6. **The browser-session feature is deleted** (recorded here because it is why
   the v8 schema bump and the `session` entity removal exist):
   `data/chromeSession` (snapshots, saver, store, 689 LOC),
   `ui/manager/SessionBrowser` (442 LOC), the `BrowserSession` sidebar entry,
   the `session` route, `background/session.ts` and the `chromesession` object
   store are gone, and `'session'` left the sync entity list.
   **The server keeps accepting the `session` entity and keeps retention for
   it.** An older build can still be installed on a profile (see below), and it
   will go on pushing snapshots; retention is the 66 LOC that stops those from
   filling someone's database forever, so it stays until the entity can be
   dropped server-side as well.

## Notable details

- **Dexie 3 has no db-level write hooks**; they are per table
  (`db.tables.forEach(t => t.hook(...))`) and only exist after the schema has
  been read, so `startChangeFeed()` is async and must be awaited before a
  context's first write.
- **The `updating` hook receives the diff, not the committed row.** The payload
  sent to the server has to be the whole record, so the feed re-reads the row -
  and it must do that from `transaction.on('complete')`. A read issued inside the
  hook joins the still-open write transaction (Dexie keeps it as the ambient
  one) and returns the _pre-update_ value. `changeFeed.hooks.test.ts` exists
  specifically to pin this down; it caught that bug during development.
- **Writes are batched per microtask** before `handleChanges` runs, so a
  `bulkPut` of 50 rows costs one config read rather than fifty.
- **Hooks fire before commit.** An aborted transaction can leave an outbox entry
  for a row that was never written; the entry is replaced by the next real write
  and the outbox is an intent log, so this is benign. The old addon only reported
  committed changes.
- **Remote applies still notify the UI** but not the outbox: the engine writes
  rows on behalf of other windows and devices, and the open page has to re-read
  its counts and lists.
- The service worker starts the change feed **whether or not a server is
  paired**, because it is also the writer of session snapshots that the UI
  listens for.

## Consequences

- ~850 LOC of coordination machinery and one stale beta dependency are gone; the
  worker chunk loses about 4 kB gzip, which was never the point.
- No more "could not establish connection" failures between the worker and other
  windows, and the `getStateTabSpaceRegistry` lookups on every tab
  added/updated/removed event are gone.
- **The v7 -> v8 schema bump is safe in both directions.** `TabSpaceDatabase`
  drops the store Dexie no longer declares, and an _older_ build opening the
  result re-creates it rather than failing: Dexie compares schemas, bumps the
  native version itself and logs a `SchemaDiff` warning. Both directions are
  covered by `src/storage/__tests__/TabSpaceDatabase.upgrade.test.ts`, which
  builds a genuine v7 database with raw IndexedDB instead of trusting a
  comment. (An earlier draft of this ADR claimed the rollback would fail with
  `VersionError`; the test disproved it.)
- `loadToCurrentWindowUtil` and the `LiveTabSpace` sidebar entry got simpler
  because they no longer have to deregister anything.
- Sync behaviour itself is unchanged: the outbox, LWW, tombstones and the delta
  cursor are untouched, and the change-feed unit tests still describe the same
  behaviour - they now drive `handleChanges()` with a `LocalWrite` shape instead
  of a dexie-observable `IDatabaseChange`.
