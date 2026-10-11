import { $allNote, noteStoreApi } from './store';
import {
  ALLNOTE_DB_TABLE_NAME,
  AllNote,
  AllNoteSavePayload,
  addNote,
  convertAndGetAllNoteSavePayload,
  newEmptyAllNote,
  updateTabSpaceId,
} from './AllNote';
import {
  NOTE_DB_TABLE_NAME,
  Note,
  newEmptyNote,
  setData,
  setName,
} from './Note';
import { addPagingToQueryParams, db } from '../../storage/db';
import { debounce } from '../../global';

import { DEFAULT_SAVE_DEBOUNCE } from '../../storage/StorageOverview';
import { updateFromSaved } from '../Base';

export async function loadAllNoteByTabSpaceId(tabSpaceId: string) {
  const savedAllNote = await queryAllNote(
    tabSpaceId,
    addPagingToQueryParams({}),
  );
  noteStoreApi.update(savedAllNote);
  noteStoreApi.updateLastSavedTime(savedAllNote.updatedAt);
}

export async function saveAllNote(): Promise<number> {
  // super stupid saving strategy: save them all when needed
  const updatedAt = await db.transaction(
    'rw',
    [db.table(NOTE_DB_TABLE_NAME), db.table(ALLNOTE_DB_TABLE_NAME)],
    async (_tx) => {
      const { allNote, allNoteSavePayload, noteSavePayloads } =
        convertAndGetAllNoteSavePayload($allNote.getState());
      await db.table(NOTE_DB_TABLE_NAME).bulkPut(noteSavePayloads);
      await db.table(ALLNOTE_DB_TABLE_NAME).put(allNoteSavePayload);
      noteStoreApi.update(allNote);
      return allNoteSavePayload.updatedAt;
    },
  );
  return updatedAt;
}

const saveCurrentAllNoteImpl = async () => {
  noteStoreApi.markInSaving(true);
  const savedTime = await saveAllNote();
  noteStoreApi.updateLastSavedTime(savedTime);
  noteStoreApi.markInSaving(false);
};

export const saveCurrentAllNote = debounce(
  saveCurrentAllNoteImpl,
  DEFAULT_SAVE_DEBOUNCE,
);

export const saveCurrentNotes = () => {
  // a tabverse is born saved (its id is minted when the tab is opened), so
  // there is no "not saved yet" state to fall back to
  saveCurrentAllNote();
};

/** A new note from a summary: the given name and HTML body. */
export function newSummaryNote(name: string, html: string): Note {
  return setData(html, setName(name, newEmptyNote()));
}

/**
 * Adds a note to a tabverse and saves at once (not debounced).
 *
 * If the in-memory notes belong to another tabverse - the Note panel has not
 * been opened, or was last opened on a different one - they are loaded first,
 * so the note is appended to the right list rather than a stale one. When the
 * panel is open the list is already this tabverse's, and this save also flushes
 * whatever edits are still pending.
 */
export async function addNoteToTabSpace(
  tabSpaceId: string,
  note: Note,
): Promise<void> {
  if ($allNote.getState().tabSpaceId !== tabSpaceId) {
    await loadAllNoteByTabSpaceId(tabSpaceId);
  }
  noteStoreApi.addNote(note);
  const savedAt = await saveAllNote();
  noteStoreApi.updateLastSavedTime(savedAt);
}

export async function queryAllNote(
  tabSpaceId: string,
  _params?: any,
): Promise<AllNote> {
  const allNotesData = await db
    .table<AllNoteSavePayload>(ALLNOTE_DB_TABLE_NAME)
    .where('tabSpaceId')
    .equals(tabSpaceId)
    .toArray();
  if (allNotesData.length <= 0) {
    return updateTabSpaceId(tabSpaceId, newEmptyAllNote());
  } else {
    const savedAllNote = allNotesData[0];
    let allNote = updateTabSpaceId(
      savedAllNote.tabSpaceId,
      updateFromSaved(savedAllNote, newEmptyAllNote()),
    );
    const notesData = await db
      .table<Note>(NOTE_DB_TABLE_NAME)
      .bulkGet(allNotesData[0].noteIds);
    notesData.forEach((noteData) => {
      allNote = addNote(noteData, allNote);
    });
    return allNote;
  }
}
