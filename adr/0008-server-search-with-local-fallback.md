# ADR 0008: search is the server's index, or a local scan

Status: accepted (2026-09)

Supersedes the "client side full text index" half of
[ADR 0001](0001-server-authoritative-sync.md) §6. Extends
[ADR 0007](0007-history-tool-and-closedtab-entity.md) on closed tabs.

## Context

ADR 0001 replaced ~760 LOC of client side indexing with SQLite FTS5 on the
server, but only on paper: the client kept its own index (`TabSpaceFullText`,
a second Dexie database with a multiEntry `terms` index, an `Intl.Segmenter`
tokenizer, language guessing, stop word lists, an indexer, a cursor based
pager and a set of runtime messages to keep it fed from the service worker),
and `serverApi.search()` had **no caller at all**. Two search stacks, only one
of them alive.

The client index was also quietly broken, in ways that made it worse the more
data a profile had:

- tabs were indexed **once**, by `reIndexAll()` on the first run of an empty
  index. A tab opened, renamed or navigated afterwards was never searchable,
  and a deleted tab's rows were never removed (the handler existed, nothing
  called it). Only tabverse names were re-indexed, on every save.
- `note`, `todo` and `bookmark` types were declared and had no handlers at
  all, so the right side tools were unsearchable by construction.

Meanwhile the server index covers the whole account, is maintained inside the
same transaction as the records themselves, and is already exercised by
`go test`. Keeping a second, weaker index in the browser to avoid one HTTP
round trip is not a trade worth making.

## Decision

**One search path, two backends, one answer format.**

1. **The client keeps no index.** `src/fullTextSearch/` (database, indexer,
   tokenizer, stop words, language guesser, searcher) and
   `src/background/fullTextSearch/` (add/remove handlers, the runtime message
   plumbing, `reIndexAll`) are deleted, along with the `FullTextSearchMsg`
   messages and the calls in `saveTabSpace` / `deleteSavedTabSpace`. What
   survives is the query model (`Query` = an OR of AND-groups, each with a
   `{type, field}` scope) and the search box UI, which move to
   `src/data/search/Query.ts` and `src/ui/common/SearchInput/`.
2. **Paired device → server FTS5.** Each AND-group is one `GET /api/v1/search`
   (the server ANDs the terms, prefix matching the last one); the groups are
   unioned client side. A `type` scope becomes the server's `entity=` filter.
3. **Unpaired (or a server that errors) → local scan.** `localSearch.ts` walks
   the tables behind the scope and does a case insensitive substring test,
   capped at `LOCAL_SEARCH_LIMIT` matched tabverses so a one letter query
   cannot walk a whole profile. The tabverse is still the unit of the result.
4. **Every hit is resolved to a tabverse, then filtered against local rows.**
   The server now returns `tabspace_id` per hit (a join with `records`, see
   `server/internal/store/search.go`) so a match on one tab, note, todo,
   bookmark or closed tab means "this tabverse matched" without the client
   fetching each hit. The client keeps only the tabverses it has rows for, and
   reports the rest as "not downloaded yet" in the search status line - a
   silent drop would look like a broken search.
5. **A `field` scope is checked locally, on both backends.** The server
   concatenates a record's strings and does not remember which field a term
   came from, so a field scoped group is verified against the local row; a row
   this device does not have is dropped rather than assumed to match.
6. **Paging is one mechanism.** Both backends answer with a ranked list of
   tabverse ids, so browsing and searching page the same way and the
   base64 index cursors are gone.
7. **`closedtab` is indexed server side** (ADR 0007 deferred it). The reason
   it deferred no longer holds: a hit is resolved to a tabverse and filtered
   against local rows, and a row the client prunes is tombstoned, which
   removes the index row with it. Ids (`id`, `tabSpaceId`, the aggregate id
   lists) are no longer indexed at all, so they cannot match content or show
   up in a snippet.

## Consequences

- The two backends do not match exactly, and the UI says which one answered
  ("searched on the sync server" / "searched on this device"): the server
  tokenizes and ranks with bm25, the local scan is a substring test with no
  ranking beyond table order. Pairing a device improves search, it does not
  change what the data is.
- Search now works for notes, todos, bookmarks and closed tabs, offline as
  well as online, which the client index never did for any of them.
- A search on an unpaired device with a large profile is a table scan. It is
  bounded by `LOCAL_SEARCH_LIMIT` and it is the price of not maintaining a
  second index; the profiles that would notice are the ones that should pair a
  device anyway.
- The offline path reads the pairing config on every search (a `chrome.storage`
  read, no network). A missing or unreadable config is treated as "no server",
  not as an error.
- `ADR 0001 §6` should be read as "the server owns search" rather than "the
  client index is replaced by the server"; this ADR is the second half of that
  work.
