import { getNewId, type IBase } from '../common';
import { TABSPACE_DB_VERSION } from '../../global';
import { db } from '../../storage/db';
import {
  ALLBOOKMARK_DB_TABLE_NAME,
  AllBookmarkSavePayload,
} from '../bookmark/AllBookmark';
import { BOOKMARK_DB_TABLE_NAME, Bookmark } from '../bookmark/Bookmark';
import { CLOSED_TAB_DB_TABLE_NAME, ClosedTab } from '../closedTab/ClosedTab';
import { ALLNOTE_DB_TABLE_NAME, AllNoteSavePayload } from '../note/AllNote';
import { NOTE_DB_TABLE_NAME, Note } from '../note/Note';
import { ALLTODO_DB_TABLE_NAME, AllTodoSavePayload } from '../todo/AllTodo';
import { TODO_DB_TABLE_NAME, Todo } from '../todo/Todo';
import { TAB_DB_TABLE_NAME, TabSavePayload } from './Tab';
import { TABSPACE_DB_TABLE_NAME, TabSpaceSavePayload } from './TabSpace';
import {
  TABVERSE_EXPORT_FORMAT,
  TABVERSE_EXPORT_VERSION,
  TabverseExport,
} from './exportTabSpace';

export interface ImportResult {
  tabSpaceId: string;
  name: string;
}

/** A record that belongs to a tabverse and is re-parented on import. */
type OwnedRow = IBase & { tabSpaceId: string };

/** The local stamp appended to an imported tabverse's name: 2026-10-11 14:30. */
export function formatImportTime(now: number): string {
  const date = new Date(now);
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** The literal prefix every imported tabverse gets, so it is obvious at a glance. */
export const IMPORTED_TABVERSE_PREFIX = 'Imported: ';

export function importedTabverseName(
  originalName: string,
  now: number,
): string {
  const base = originalName.trim() || 'Tabverse';
  return `${IMPORTED_TABVERSE_PREFIX}${base} - ${formatImportTime(now)}`;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Reads a `.tabverse` document. It refuses anything that is not one, and a
 * version this build does not understand, rather than importing half of it.
 */
export function parseTabverseExport(text: string): TabverseExport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('the file is not JSON');
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error('the file is not a tabverse export');
  }
  const doc = raw as Partial<TabverseExport>;
  if (doc.format !== TABVERSE_EXPORT_FORMAT) {
    throw new Error('the file is not a tabverse export');
  }
  if (
    typeof doc.version !== 'number' ||
    doc.version > TABVERSE_EXPORT_VERSION
  ) {
    throw new Error('the file was written by a newer Tabverse');
  }
  if (!doc.tabverse || typeof doc.tabverse !== 'object') {
    throw new Error('the export has no tabverse');
  }
  return {
    format: TABVERSE_EXPORT_FORMAT,
    version: doc.version,
    exportedAt: typeof doc.exportedAt === 'number' ? doc.exportedAt : 0,
    tabverse: doc.tabverse as TabSpaceSavePayload,
    tabs: asArray<TabSavePayload>(doc.tabs),
    notes: asArray<Note>(doc.notes),
    todos: asArray<Todo>(doc.todos),
    bookmarks: asArray<Bookmark>(doc.bookmarks),
    history: asArray<ClosedTab>(doc.history),
    aggregates: {
      allNote: (doc.aggregates?.allNote as AllNoteSavePayload) ?? null,
      allTodo: (doc.aggregates?.allTodo as AllTodoSavePayload) ?? null,
      allBookmark:
        (doc.aggregates?.allBookmark as AllBookmarkSavePayload) ?? null,
    },
  };
}

export async function importTabverseFile(file: File): Promise<ImportResult> {
  const text = await file.text();
  return importTabverse(parseTabverseExport(text));
}

/**
 * Writes an exported tabverse as a brand new one.
 *
 * Every id is reminted and every reference rewritten (`tabIds`, the tab groups,
 * each tab's `splitWith`, the ordering aggregates, and each row's `tabSpaceId`),
 * so importing the same file twice - or into a profile that already holds the
 * original - never collides. The new tabverse is named after the original with
 * the import time appended, and is left in the saved list, not opened.
 */
export async function importTabverse(
  data: TabverseExport,
): Promise<ImportResult> {
  const now = Date.now();
  const tabSpaceId = getNewId();
  const name = importedTabverseName(data.tabverse.name, now);

  const tabs: TabSavePayload[] = data.tabs.map((tab) => ({
    ...tab,
    id: getNewId(),
    tabSpaceId,
    version: TABSPACE_DB_VERSION,
    createdAt: now,
    updatedAt: now,
  }));
  const tabIdMap = new Map(
    data.tabs.map((tab, index) => [tab.id, tabs[index].id]),
  );
  for (const tab of tabs) {
    if (tab.splitWith) {
      tab.splitWith = tabIdMap.get(tab.splitWith);
    }
  }
  const newTabId = (oldId: string) => tabIdMap.get(oldId);
  const tabIds = data.tabverse.tabIds
    .map(newTabId)
    .filter((id): id is string => Boolean(id));

  const tabverse: TabSpaceSavePayload = {
    ...data.tabverse,
    id: tabSpaceId,
    name,
    tabIds,
    tabGroups: (data.tabverse.tabGroups ?? []).map((group) => ({
      ...group,
      tabIds: group.tabIds
        .map(newTabId)
        .filter((id): id is string => Boolean(id)),
    })),
    version: TABSPACE_DB_VERSION,
    createdAt: now,
    updatedAt: now,
  };

  const remint = <T extends OwnedRow>(rows: T[]): T[] =>
    rows.map(
      (row) =>
        ({
          ...row,
          id: getNewId(),
          tabSpaceId,
          version: TABSPACE_DB_VERSION,
          createdAt: now,
          updatedAt: now,
        }) as T,
    );

  const notes = remint(data.notes);
  const todos = remint(data.todos);
  const bookmarks = remint(data.bookmarks);
  const history = remint(data.history);

  const allNote: AllNoteSavePayload | null = data.aggregates.allNote
    ? {
        ...data.aggregates.allNote,
        id: getNewId(),
        tabSpaceId,
        noteIds: notes.map((note) => note.id),
        version: TABSPACE_DB_VERSION,
        createdAt: now,
        updatedAt: now,
      }
    : null;
  const allTodo: AllTodoSavePayload | null = data.aggregates.allTodo
    ? {
        ...data.aggregates.allTodo,
        id: getNewId(),
        tabSpaceId,
        todoIds: todos.map((todo) => todo.id),
        version: TABSPACE_DB_VERSION,
        createdAt: now,
        updatedAt: now,
      }
    : null;
  const allBookmark: AllBookmarkSavePayload | null = data.aggregates.allBookmark
    ? {
        ...data.aggregates.allBookmark,
        id: getNewId(),
        tabSpaceId,
        bookmarkIds: bookmarks.map((bookmark) => bookmark.id),
        version: TABSPACE_DB_VERSION,
        createdAt: now,
        updatedAt: now,
      }
    : null;

  await db.transaction(
    'rw',
    [
      db.table(TABSPACE_DB_TABLE_NAME),
      db.table(TAB_DB_TABLE_NAME),
      db.table(ALLNOTE_DB_TABLE_NAME),
      db.table(NOTE_DB_TABLE_NAME),
      db.table(ALLTODO_DB_TABLE_NAME),
      db.table(TODO_DB_TABLE_NAME),
      db.table(ALLBOOKMARK_DB_TABLE_NAME),
      db.table(BOOKMARK_DB_TABLE_NAME),
      db.table(CLOSED_TAB_DB_TABLE_NAME),
    ],
    async () => {
      await db.table(TABSPACE_DB_TABLE_NAME).put(tabverse);
      if (tabs.length > 0) await db.table(TAB_DB_TABLE_NAME).bulkPut(tabs);
      if (allNote) {
        await db.table(ALLNOTE_DB_TABLE_NAME).put(allNote);
        if (notes.length > 0) {
          await db.table(NOTE_DB_TABLE_NAME).bulkPut(notes);
        }
      }
      if (allTodo) {
        await db.table(ALLTODO_DB_TABLE_NAME).put(allTodo);
        if (todos.length > 0) {
          await db.table(TODO_DB_TABLE_NAME).bulkPut(todos);
        }
      }
      if (allBookmark) {
        await db.table(ALLBOOKMARK_DB_TABLE_NAME).put(allBookmark);
        if (bookmarks.length > 0) {
          await db.table(BOOKMARK_DB_TABLE_NAME).bulkPut(bookmarks);
        }
      }
      if (history.length > 0) {
        await db.table(CLOSED_TAB_DB_TABLE_NAME).bulkPut(history);
      }
    },
  );

  return { tabSpaceId, name };
}
