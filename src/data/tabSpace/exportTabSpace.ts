import { ALLNOTE_DB_TABLE_NAME, AllNoteSavePayload } from '../note/AllNote';
import { NOTE_DB_TABLE_NAME, Note } from '../note/Note';
import { $allNote } from '../note/store';
import { saveAllNote } from '../note/util';
import { ALLTODO_DB_TABLE_NAME, AllTodoSavePayload } from '../todo/AllTodo';
import { TODO_DB_TABLE_NAME, Todo } from '../todo/Todo';
import { $allTodo } from '../todo/store';
import { saveAllTodo } from '../todo/util';
import {
  ALLBOOKMARK_DB_TABLE_NAME,
  AllBookmarkSavePayload,
} from '../bookmark/AllBookmark';
import { BOOKMARK_DB_TABLE_NAME, Bookmark } from '../bookmark/Bookmark';
import { $allBookmark } from '../bookmark/store';
import { saveAllBookmark } from '../bookmark/util';
import { CLOSED_TAB_DB_TABLE_NAME, ClosedTab } from '../closedTab/ClosedTab';
import { $allClosedTab } from '../closedTab/store';
import { saveAllClosedTabs } from '../closedTab/util';
import { db } from '../../storage/db';
import { TAB_DB_TABLE_NAME, TabSavePayload } from './Tab';
import { TABSPACE_DB_TABLE_NAME, TabSpaceSavePayload } from './TabSpace';
import { saveCurrentTabSpaceNow } from './util';

/** The marker that says what a `.tabverse` file is. */
export const TABVERSE_EXPORT_FORMAT = 'tabverse';
/** Bumped when the file layout changes; a reader refuses what it cannot read. */
export const TABVERSE_EXPORT_VERSION = 1;

/**
 * Everything one tabverse holds, as one JSON document. The rows are the
 * persisted save payloads (plain data, no live Chrome/Immutable state), so the
 * file is a faithful snapshot of the tabverse and not of this window.
 */
export interface TabverseExport {
  format: typeof TABVERSE_EXPORT_FORMAT;
  version: number;
  exportedAt: number;
  tabverse: TabSpaceSavePayload;
  tabs: TabSavePayload[];
  notes: Note[];
  todos: Todo[];
  bookmarks: Bookmark[];
  history: ClosedTab[];
  /** The ordering aggregates, kept so a later import can rebuild the order. */
  aggregates: {
    allNote: AllNoteSavePayload | null;
    allTodo: AllTodoSavePayload | null;
    allBookmark: AllBookmarkSavePayload | null;
  };
}

/**
 * Flushes whatever is still pending for this tabverse, so the file includes an
 * edit made a moment ago. Only the stores that currently hold *this* tabverse
 * are flushed; the others have nothing pending for it. The tabverse itself is
 * always saved now, because a debounced save may not have fired yet.
 */
async function flushPending(tabSpaceId: string): Promise<void> {
  await saveCurrentTabSpaceNow();
  const pending: Promise<unknown>[] = [];
  if ($allNote.getState().tabSpaceId === tabSpaceId) {
    pending.push(saveAllNote());
  }
  if ($allTodo.getState().tabSpaceId === tabSpaceId) {
    pending.push(saveAllTodo());
  }
  if ($allBookmark.getState().tabSpaceId === tabSpaceId) {
    pending.push(saveAllBookmark());
  }
  if ($allClosedTab.getState().tabSpaceId === tabSpaceId) {
    pending.push(saveAllClosedTabs());
  }
  await Promise.all(pending);
}

function first<T>(rows: T[]): T | null {
  return rows.length > 0 ? rows[0] : null;
}

function present<T>(rows: (T | undefined)[]): T[] {
  return rows.filter((row): row is T => row !== undefined);
}

/** Reads a tabverse and all of its rows out of the database. */
async function collectTabverseExport(
  tabSpaceId: string,
): Promise<TabverseExport> {
  const tabverse = await db
    .table<TabSpaceSavePayload>(TABSPACE_DB_TABLE_NAME)
    .get(tabSpaceId);
  if (!tabverse) {
    throw new Error(`tabverse ${tabSpaceId} is not saved`);
  }

  const [tabs, allNotes, allTodos, allBookmarks, history] = await Promise.all([
    db.table<TabSavePayload>(TAB_DB_TABLE_NAME).bulkGet(tabverse.tabIds),
    db
      .table<AllNoteSavePayload>(ALLNOTE_DB_TABLE_NAME)
      .where('tabSpaceId')
      .equals(tabSpaceId)
      .toArray(),
    db
      .table<AllTodoSavePayload>(ALLTODO_DB_TABLE_NAME)
      .where('tabSpaceId')
      .equals(tabSpaceId)
      .toArray(),
    db
      .table<AllBookmarkSavePayload>(ALLBOOKMARK_DB_TABLE_NAME)
      .where('tabSpaceId')
      .equals(tabSpaceId)
      .toArray(),
    db
      .table<ClosedTab>(CLOSED_TAB_DB_TABLE_NAME)
      .where('tabSpaceId')
      .equals(tabSpaceId)
      .toArray(),
  ]);

  const allNote = first(allNotes);
  const allTodo = first(allTodos);
  const allBookmark = first(allBookmarks);

  const [notes, todos, bookmarks] = await Promise.all([
    allNote
      ? db.table<Note>(NOTE_DB_TABLE_NAME).bulkGet(allNote.noteIds)
      : Promise.resolve([] as (Note | undefined)[]),
    allTodo
      ? db.table<Todo>(TODO_DB_TABLE_NAME).bulkGet(allTodo.todoIds)
      : Promise.resolve([] as (Todo | undefined)[]),
    allBookmark
      ? db
          .table<Bookmark>(BOOKMARK_DB_TABLE_NAME)
          .bulkGet(allBookmark.bookmarkIds)
      : Promise.resolve([] as (Bookmark | undefined)[]),
  ]);

  return {
    format: TABVERSE_EXPORT_FORMAT,
    version: TABVERSE_EXPORT_VERSION,
    exportedAt: Date.now(),
    tabverse,
    tabs: present(tabs),
    notes: present(notes),
    todos: present(todos),
    bookmarks: present(bookmarks),
    history,
    aggregates: { allNote, allTodo, allBookmark },
  };
}

/** A filesystem-safe `.tabverse` file name from the tabverse's own name. */
export function tabverseFileName(
  name: string | undefined,
  tabSpaceId: string,
): string {
  const base = (name ?? '').trim() || tabSpaceId || 'tabverse';
  const safe = base
    .replace(/[\p{Cc}\\/:*?"<>|]/gu, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return `${safe || 'tabverse'}.tabverse`;
}

/** Hands a value to the browser as a download. */
function downloadJSON(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Exports the tabverse to a `.tabverse` file. The current tabverse is flushed
 * first, so the file holds what is on screen, not the last autosave.
 */
export async function exportTabVerse(
  tabSpaceId: string,
  name: string | undefined,
): Promise<void> {
  await flushPending(tabSpaceId);
  const data = await collectTabverseExport(tabSpaceId);
  downloadJSON(tabverseFileName(name, tabSpaceId), data);
}
