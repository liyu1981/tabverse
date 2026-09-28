/**
 * Bridge between the extension's Dexie database and the sync record model.
 *
 * Every synced table maps to exactly one entity; the record payload is the
 * stored row itself (all rows are SavePayload objects, i.e. plain JSON, so
 * no conversion is needed). The per tabspace aggregates (SavedAll*) are
 * synced too: they carry the ordering of notes/todos/bookmarks, which could
 * not be reconstructed from the entity rows alone.
 */

import { db } from '../../storage/db';
import { isIdNotSaved } from '../common';
import { ALLBOOKMARK_DB_TABLE_NAME } from '../bookmark/AllBookmark';
import { BOOKMARK_DB_TABLE_NAME } from '../bookmark/Bookmark';
import { ALLNOTE_DB_TABLE_NAME } from '../note/AllNote';
import { NOTE_DB_TABLE_NAME } from '../note/Note';
import { ALLTODO_DB_TABLE_NAME } from '../todo/AllTodo';
import { TODO_DB_TABLE_NAME } from '../todo/Todo';
import { TAB_DB_TABLE_NAME } from '../tabSpace/Tab';
import { TABSPACE_DB_TABLE_NAME } from '../tabSpace/TabSpace';
import { EntityName, RecordInput, SyncRecord } from './types';

export interface SyncTableBinding {
  entity: EntityName;
  table: string;
}

/** Single source of truth for the entity <-> table mapping. */
export const SYNC_TABLE_BINDINGS: SyncTableBinding[] = [
  { entity: 'tabspace', table: TABSPACE_DB_TABLE_NAME },
  { entity: 'tab', table: TAB_DB_TABLE_NAME },
  { entity: 'note', table: NOTE_DB_TABLE_NAME },
  { entity: 'allnote', table: ALLNOTE_DB_TABLE_NAME },
  { entity: 'todo', table: TODO_DB_TABLE_NAME },
  { entity: 'alltodo', table: ALLTODO_DB_TABLE_NAME },
  { entity: 'bookmark', table: BOOKMARK_DB_TABLE_NAME },
  { entity: 'allbookmark', table: ALLBOOKMARK_DB_TABLE_NAME },
];

const TABLE_TO_ENTITY: { [table: string]: EntityName } = (() => {
  const out: { [table: string]: EntityName } = {};
  for (const b of SYNC_TABLE_BINDINGS) {
    out[b.table] = b.entity;
  }
  return out;
})();

const ENTITY_TO_TABLE: { [entity: string]: string } = (() => {
  const out: { [table: string]: string } = {};
  for (const b of SYNC_TABLE_BINDINGS) {
    out[b.entity] = b.table;
  }
  return out;
})();

function isEmptyTabSpaceRow(row: any): boolean {
  const tabIds = row.tabIds;
  return Array.isArray(tabIds) ? tabIds.length === 0 : !tabIds;
}

export function entityForTable(table: string): EntityName | null {
  return TABLE_TO_ENTITY[table] || null;
}

export function tableForEntity(entity: string): string | null {
  return ENTITY_TO_TABLE[entity] || null;
}

/** Modification time of a stored row, in unix ms. */
export function rowUpdatedAt(row: any): number {
  if (row && typeof row.updatedAt === 'number' && row.updatedAt > 0) {
    return row.updatedAt;
  }
  if (row && typeof row.createdAt === 'number' && row.createdAt > 0) {
    return row.createdAt;
  }
  return Date.now();
}

/**
 * Reads every syncable row out of the local database. Rows that were never
 * saved (ids prefixed with `~`) are skipped: they live in the UI store only.
 */
export async function listLocalRecords(
  entities?: EntityName[],
): Promise<RecordInput[]> {
  const wanted = entities
    ? new Set<string>(entities)
    : new Set<string>(SYNC_TABLE_BINDINGS.map((b) => b.entity));
  const out: RecordInput[] = [];

  for (const binding of SYNC_TABLE_BINDINGS) {
    if (!wanted.has(binding.entity)) {
      continue;
    }
    const rows: any[] = await db.table(binding.table).toArray();
    for (const row of rows) {
      if (!row || typeof row.id !== 'string' || isIdNotSaved(row.id)) {
        continue;
      }
      if (binding.entity === 'tabspace' && isEmptyTabSpaceRow(row)) {
        // A tabverse is created the moment a Tabverse tab opens, so opening
        // and immediately closing one would otherwise leave a synced, empty
        // record behind. It uploads as soon as it holds a tab.
        continue;
      }
      out.push({
        entity: binding.entity,
        id: row.id,
        updated_at: rowUpdatedAt(row),
        deleted: false,
        payload: JSON.stringify(row),
      });
    }
  }
  return out;
}

export interface ApplyResult {
  applied: number;
  deleted: number;
  skipped: number;
  errors: number;
}

/**
 * Applies server records to the local database.
 *
 * Rules:
 *  - tombstones delete the local row
 *  - a row that is locally newer than the incoming record is kept (our push
 *    will win the LWW race; overwriting it here would lose the edit for the
 *    seconds until the flush lands)
 *  - everything else is written verbatim, the server copy wins
 */
export async function applyServerRecords(
  records: SyncRecord[],
): Promise<ApplyResult> {
  const result: ApplyResult = { applied: 0, deleted: 0, skipped: 0, errors: 0 };

  for (const record of records) {
    const table = tableForEntity(record.entity);
    if (!table || !record.id) {
      result.errors += 1;
      continue;
    }
    try {
      if (record.deleted) {
        await db.table(table).delete(record.id);
        result.deleted += 1;
        continue;
      }
      if (!record.payload) {
        result.skipped += 1;
        continue;
      }
      const local: any = await db.table(table).get(record.id);
      if (local && rowUpdatedAt(local) > record.updated_at) {
        result.skipped += 1;
        continue;
      }
      let row: any;
      try {
        row = JSON.parse(record.payload);
      } catch {
        result.errors += 1;
        continue;
      }
      if (!row || typeof row !== 'object') {
        result.errors += 1;
        continue;
      }
      // the record id is authoritative: a malformed payload must not be
      // able to write into another row's slot
      row.id = record.id;
      await db.table(table).put(row);
      result.applied += 1;
    } catch (err) {
      result.errors += 1;
    }
  }
  return result;
}
