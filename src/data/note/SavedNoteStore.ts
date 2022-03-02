import {
  AllNote,
  IAllNoteSavePayload,
  INoteJSON,
  INoteLocalStorage,
  Note,
} from './Note';
import {
  DEFAULT_SAVE_DEBOUNCE,
  InSavingStatus,
  SavedStore,
} from '../../store/store';
import {
  TabSpaceDBMsg,
  TabSpaceMsg,
  subscribePubSubMessage,
} from '../../message/message';
import { debounce, logger } from '../../global';
import {
  getLocalStorageKey,
  localStorageAddListener,
  localStorageGetItem,
  localStoragePutItem,
  localStorageRemoveListener,
} from '../../store/localStorageWrapper';

import { IDatabaseChange } from 'dexie-observable/api';
import { db } from '../../store/db';
import { getAllNoteData } from './bootstrap';
import { getTabSpaceData } from '../tabSpace/bootstrap';
import { observe } from 'mobx';

export const LOCALSTORAGE_NOTE_KEY = getLocalStorageKey('note');

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

export function startMonitorLocalStorageChanges(allNote: AllNote) {
  localStorageAddListener(LOCALSTORAGE_NOTE_KEY, (key, newValue, oldValue) => {
    const noteJSONs = JSON.parse(newValue) as INoteLocalStorage[];
    allNote.restoreFromLocalStorageJSON(noteJSONs);
  });
  // immediately load once after the monitoring is started
  loadCurrentAllNoteFromLocalStorage(allNote);
}

export function stopMonitorLocalStorageChanges() {
  localStorageRemoveListener(LOCALSTORAGE_NOTE_KEY);
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
      } else {
        logger.log(
          'current tabSpace is not on autoSave, will then save notes to localStorage',
        );
        saveCurrentAllNoteToLocalStorage();
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

function saveCurrentAllNoteToLocalStorage() {
  const { allNote } = getAllNoteData();
  localStoragePutItem(
    LOCALSTORAGE_NOTE_KEY,
    JSON.stringify(allNote.getLocalStorageJSON()),
  );
}

export async function loadCurrentAllNoteFromLocalStorage(allNote: AllNote) {
  return new Promise<void>((resolve, reject) =>
    localStorageGetItem(LOCALSTORAGE_NOTE_KEY, (value: string) => {
      const noteJSONs = JSON.parse(value) as INoteLocalStorage[];
      allNote.restoreFromLocalStorageJSON(noteJSONs);
      resolve();
    }),
  );
}
