# ADR 0007: the History tool, and closed tabs as a synced entity

Status: accepted (2026-09)

## Context

The right side of a tabverse carries three tools: Todo, Note and Bookmark.
None of them answers the question that comes up most often after a burst of
tab closing: *that page, what was it?*

Chrome has an answer (`chrome://history`, and Ctrl+Shift+T), but it is
browser-global, it is not stored in the extension, and it cannot be reached
from the tabverse. So we added a fourth tool, **History**: the tabs that were
closed *in this tabverse*, newest first, with a restore action and a
save-as-bookmark action per entry.

Two things had to be decided beyond the obvious.

1. **Where does an entry come from?** The manager page owns its window
   (ADR 0006), and `getOnChromeTabRemoved` is the one funnel every close goes
   through: the ✕ button, Ctrl+W, closing a group, closing the other tabs.
   That handler still holds the `Tab` (title, url, favicon) when it runs, so
   the entry is recorded there, before the tab leaves the store. `onDetached`
   records too - a tab dragged to another window left the tabverse, and
   Chrome's own "recently closed" remembers those too.

2. **Does the history sync?** Closed tabs are browsing data like any other tab
   row, and Tabverse's whole point since the server pivot is that a tabverse
   is the same object on every device. Deciding *not* to sync would have made
   the tool behave differently depending on whether a device was paired, which
   is the kind of surprise this codebase has been trying to remove (ADR 0006
   removed a whole feature because it behaved differently per context). So it
   syncs, as the `closedtab` entity, and the privacy consequence is the same
   one ADR 0002 already accepted: the server sees the urls you closed.

## Decision

1. **One row per closed url**, in the new `SavedClosedTab` table
   (`id, tabSpaceId, closedAt`), synced as the `closedtab` entity. No
   `SavedAllClosedTab` aggregate, unlike the other three tools: the list is
   append-mostly and its order is `closedAt`, which every row carries, so there
   is no user-made ordering to preserve and no aggregate row to sync.
2. **Closing a url that is already in the history bumps it** (newer
   `closedAt`, `timesClosed + 1`) instead of adding a row. The list answers
   "which pages did I close", not "how many times did I click ✕".
3. **At most `HISTORY_MAX_ENTRIES` (999) entries per tabverse.** The save
   deletes every row of the tabverse the store no longer holds, so pruning,
   "forget this one" and "clear all" are the same code path - and a pruned row
   is a tombstone on the server rather than an orphan.
4. **Not indexed for search.** The server's FTS index is a search over what
   the user still has; a hit on a page that fell off the history cap would be
   a dead link.
5. **No localStorage fallback.** Todo/Note/Bookmark still have one for
   tabverses that were not saved yet, but a tabverse is born saved
   (`needAutoSave()` is `true` and returns `true`), so that branch is dead
   weight and history does without it.
6. **`SavedClosedTab` is in `NOTIFY_TABLES`** (data/repo/localTables.ts): a
   tab closed on another device has to show up in the open manager page.

## Consequences

- The db auditor purges history rows whose tabverse is gone. The delete path
  for a tabverse still does not walk the right side tools (it leaves the todo,
  note and bookmark rows of a deleted tabverse behind), so for now the history
  is the only one that cleans up after itself.
- A tabverse that is deleted on one device and re-created with the same id
  elsewhere keeps its history: rows are ordinary `closedtab` records, and the
  tabverse id is the only thing tying them together.
- Restoring an entry re-opens the url with `chrome.tabs.create`, i.e. in the
  window of the tabverse showing the history, exactly like the "Open In Current
  Tabverse" action of the Bookmark tool.
