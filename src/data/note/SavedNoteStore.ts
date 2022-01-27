import { AllNote, IAllNoteSavePayload, INoteJSON, Note } from './Noote';
import {
  DEFAULT_SAVE_DEBOUNCE,
  InSavingStatus,
  SavedStore,
} from '../../store/store';
import {
  TabSpaceDBMsg,
  TabSpaceMsg,
  subscribePubSubMessage,
} from '../../message';
import { debounce, logger } from '../../global';

import { IDatabaseChange } from 'dexie-observable/api';
import { db } from '../../store/db';
import { getAllNoteData } from './bootstrap';
import { getTabSpaceData } from '../tabSpace/bootstrap';
import { observe } from 'mobx';

export class SavedNoteStore extends SavedStore {}

export function monitorDbChanges(savedStore: SavedNoteStore) {
  subscribePubSubMessage(
    TabSpaceDBMsg.Changed,
    (message, data: IDatabaseChange[]) => {
      logger.log('pubsub:', message, data);
      data.forEach((d) => {
        if (d.table === Note.DB_TABLE_NAME) {
          savedStore.increaseSavedDataVersion();
        }
      });
    },
  );
}

export function monitorTabSpaceChanges(allNote: AllNote) {
  subscribePubSubMessage(TabSpaceMsg.ChangeID, (message, data) => {
    logger.log('pubsub:', message, data);
    const { to } = data;
    allNote.updateTabSpaceId(to);
  });
}

export function monitorAllNoteChange(
  allNote: AllNote,
  savedNoteStore: SavedNoteStore,
) {
  observe(allNote, (change) => {
    logger.log('allNote changed:', change);
    if (savedNoteStore.inSaving === InSavingStatus.InSaving) {
      logger.log('note in saving, skip');
    } else {
      if (getTabSpaceData().tabSpace.needAutoSave()) {
        logger.log(
          'current tabSpace need autoSave, will then saveCurrentAllNote',
        );
        saveCurrentAllNote();
      }
    }
  });
}

export async function queryAllNote(
  tabSpaceId: string,
  params?: any,
): Promise<AllNote> {
  const allNotesData: IAllNoteSavePayload[] = await db
    .table(AllNote.DB_TABLE_NAME)
    .where('tabSpaceId')
    .equals(tabSpaceId)
    .toArray();
  if (allNotesData.length <= 0) {
    return new AllNote(tabSpaceId);
  } else {
    const allNote = AllNote.fromSavedData(allNotesData[0]);
    const notesData: INoteJSON[] = await db
      .table(Note.DB_TABLE_NAME)
      .bulkGet(allNotesData[0].noteIds);
    notesData.forEach((noteData) => allNote.addNote(Note.fromJSON(noteData)));
    return allNote;
  }
}

export async function saveAllNote(allNote: AllNote): Promise<number> {
  // super stupid saving strategy: save them all when needed
  await db.transaction(
    'rw',
    [db.table(Note.DB_TABLE_NAME), db.table(AllNote.DB_TABLE_NAME)],
    async (tx) => {
      const {
        allNoteSavePayload,
        isNewAllNote,
        newNoteSavePayloads,
        existNoteSavePayloads,
      } = allNote.convertAndGetSavePayload();
      await db.table(Note.DB_TABLE_NAME).bulkAdd(newNoteSavePayloads);
      await db.table(Note.DB_TABLE_NAME).bulkPut(existNoteSavePayloads);
      if (isNewAllNote) {
        await db.table(AllNote.DB_TABLE_NAME).add(allNoteSavePayload);
      } else {
        await db.table(AllNote.DB_TABLE_NAME).put(allNoteSavePayload);
      }
    },
  );
  return Date.now();
}

const saveCurrentAllNoteImpl = async () => {
  const { allNote, savedNoteStore } = getAllNoteData();
  savedNoteStore.markInSaving(true);
  const savedTime = await saveAllNote(allNote);
  savedNoteStore.markInSaving(false, savedTime);
};

export const saveCurrentAllNote = debounce(
  saveCurrentAllNoteImpl,
  DEFAULT_SAVE_DEBOUNCE,
);
