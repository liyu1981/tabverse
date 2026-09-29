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
import { NOTE_DB_TABLE_NAME, Note } from './Note';
import { TabSpaceMsg, subscribePubSubMessage } from '../../message/message';
import { addPagingToQueryParams, db } from '../../storage/db';
import { debounce, logger } from '../../global';

import { DEFAULT_SAVE_DEBOUNCE } from '../../storage/StorageOverview';
import { updateFromSaved } from '../Base';

export function monitorTabSpaceChanges() {
  subscribePubSubMessage(TabSpaceMsg.ChangeID, (message, data) => {
    logger.log('pubsub:', message, data);
    const { to } = data;
    noteStoreApi.updateTabSpaceId(to);
  });
}

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
    async (tx) => {
      const {
        allNote,
        allNoteSavePayload,
        isNewAllNote,
        newNoteSavePayloads,
        existNoteSavePayloads,
      } = convertAndGetAllNoteSavePayload($allNote.getState());
      await db.table(NOTE_DB_TABLE_NAME).bulkAdd(newNoteSavePayloads);
      await db.table(NOTE_DB_TABLE_NAME).bulkPut(existNoteSavePayloads);
      if (isNewAllNote) {
        await db.table(ALLNOTE_DB_TABLE_NAME).add(allNoteSavePayload);
      } else {
        await db.table(ALLNOTE_DB_TABLE_NAME).put(allNoteSavePayload);
      }
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
