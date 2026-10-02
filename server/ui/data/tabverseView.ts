/**
 * What is left of the console's own reading of a tabverse, after the tab list
 * moved to the extension's components (`adr/0019`).
 *
 * Only the count survives: it belongs to the console because the folded-away
 * section below the cards - notes, todos, bookmarks, closed tabs - is the
 * console's own addition. An operator wants to know how much of it there is
 * before opening it; the extension has no such section, because an extension
 * shows its own notes in the panel beside it.
 */

import type { TabspaceBundle } from './types';

export function storedCount(bundle: TabspaceBundle): number {
  return (
    bundle.notes.length +
    bundle.todos.length +
    bundle.bookmarks.length +
    bundle.closed_tabs.length
  );
}
