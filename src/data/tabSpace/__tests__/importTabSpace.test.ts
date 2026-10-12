import { beforeEach, expect, test } from 'vitest';

import { resetTestDb } from '../../../dev/dbImplTest';
import { db } from '../../../storage/db';
import { ALLNOTE_DB_TABLE_NAME, AllNoteSavePayload } from '../../note/AllNote';
import { NOTE_DB_TABLE_NAME, Note } from '../../note/Note';
import { TAB_DB_TABLE_NAME, TabSavePayload } from '../Tab';
import { TABSPACE_DB_TABLE_NAME, TabSpaceSavePayload } from '../TabSpace';
import { TabverseExport } from '../exportTabSpace';
import {
  formatImportTime,
  importTabverse,
  importedTabverseName,
  parseTabverseExport,
} from '../importTabSpace';

function fixture(): TabverseExport {
  return {
    format: 'tabverse',
    version: 1,
    exportedAt: 1,
    tabverse: {
      id: 'ts-old',
      version: 1,
      createdAt: 1,
      updatedAt: 2,
      name: 'Research',
      tabIds: ['tab-a', 'tab-b'],
      tabGroups: [
        { id: 'g1', title: 'Group', color: 'blue', tabIds: ['tab-a'] },
      ],
    },
    tabs: [
      {
        id: 'tab-a',
        version: 1,
        createdAt: 1,
        updatedAt: 2,
        tabSpaceId: 'ts-old',
        title: 'A',
        url: 'https://a.example',
        favIconUrl: '',
        pinned: false,
        suspended: false,
        splitWith: 'tab-b',
      },
      {
        id: 'tab-b',
        version: 1,
        createdAt: 1,
        updatedAt: 2,
        tabSpaceId: 'ts-old',
        title: 'B',
        url: 'https://b.example',
        favIconUrl: '',
        pinned: false,
        suspended: false,
        splitWith: 'tab-a',
      },
    ],
    notes: [
      {
        id: 'note-1',
        version: 1,
        createdAt: 1,
        updatedAt: 2,
        tabSpaceId: 'ts-old',
        name: 'N',
        data: '<p>x</p>',
      },
    ],
    todos: [
      {
        id: 'todo-1',
        version: 1,
        createdAt: 1,
        updatedAt: 2,
        tabSpaceId: 'ts-old',
        content: 'T',
        completed: false,
      },
    ],
    bookmarks: [
      {
        id: 'bm-1',
        version: 1,
        createdAt: 1,
        updatedAt: 2,
        tabSpaceId: 'ts-old',
        name: 'B',
        url: 'https://b.example',
        favIconUrl: '',
      },
    ],
    history: [
      {
        id: 'ct-1',
        version: 1,
        createdAt: 1,
        updatedAt: 2,
        tabSpaceId: 'ts-old',
        title: 'H',
        url: 'https://h.example',
        favIconUrl: '',
        closedAt: 5,
        timesClosed: 1,
      },
    ],
    aggregates: {
      allNote: {
        id: 'allnote-1',
        version: 1,
        createdAt: 1,
        updatedAt: 2,
        tabSpaceId: 'ts-old',
        noteIds: ['note-1'],
      },
      allTodo: {
        id: 'alltodo-1',
        version: 1,
        createdAt: 1,
        updatedAt: 2,
        tabSpaceId: 'ts-old',
        todoIds: ['todo-1'],
      },
      allBookmark: {
        id: 'allbm-1',
        version: 1,
        createdAt: 1,
        updatedAt: 2,
        tabSpaceId: 'ts-old',
        bookmarkIds: ['bm-1'],
      },
    },
  };
}

beforeEach(async () => {
  await resetTestDb();
});

test('names an imported tabverse after the original plus the time', () => {
  const now = new Date('2026-10-11T14:30:00').getTime();
  expect(formatImportTime(now)).toBe('2026-10-11 14:30');
  expect(importedTabverseName('Research', now)).toBe(
    'Imported: Research - 2026-10-11 14:30',
  );
  expect(importedTabverseName('   ', now)).toBe(
    'Imported: Tabverse - 2026-10-11 14:30',
  );
});

test('refuses a file that is not a tabverse export', () => {
  expect(() => parseTabverseExport('not json')).toThrow();
  expect(() => parseTabverseExport('{"hello":1}')).toThrow();
  expect(() =>
    parseTabverseExport(JSON.stringify({ format: 'tabverse', version: 99 })),
  ).toThrow();
});

test('imports with fresh ids and remapped references', async () => {
  const result = await importTabverse(fixture());

  const tabverse = (await db
    .table<TabSpaceSavePayload>(TABSPACE_DB_TABLE_NAME)
    .get(result.tabSpaceId))!;
  expect(tabverse.name).toBe(result.name);
  expect(tabverse.id).not.toBe('ts-old');
  expect(tabverse.tabIds).toHaveLength(2);
  expect(tabverse.tabIds).not.toContain('tab-a');
  expect(tabverse.tabGroups[0].tabIds).toEqual([tabverse.tabIds[0]]);

  const tabs = (await db
    .table<TabSavePayload>(TAB_DB_TABLE_NAME)
    .bulkGet(tabverse.tabIds)) as TabSavePayload[];
  expect(tabs.every((tab) => tab.tabSpaceId === result.tabSpaceId)).toBe(true);
  // the split pair is remapped to the new ids and still points at each other
  expect(tabs[0].splitWith).toBe(tabs[1].id);
  expect(tabs[1].splitWith).toBe(tabs[0].id);

  const allNote = (
    await db
      .table<AllNoteSavePayload>(ALLNOTE_DB_TABLE_NAME)
      .where('tabSpaceId')
      .equals(result.tabSpaceId)
      .toArray()
  )[0];
  const note = (await db
    .table<Note>(NOTE_DB_TABLE_NAME)
    .get(allNote.noteIds[0]))!;
  expect(note.id).not.toBe('note-1');
  expect(note.tabSpaceId).toBe(result.tabSpaceId);
});

test('importing the same file twice makes two independent tabverses', async () => {
  const first = await importTabverse(fixture());
  const second = await importTabverse(fixture());
  expect(first.tabSpaceId).not.toBe(second.tabSpaceId);
  expect(await db.table(TABSPACE_DB_TABLE_NAME).count()).toBe(2);
});
