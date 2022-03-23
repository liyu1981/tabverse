import { isArray } from 'lodash';
import { isJestTest } from '../../debug';
import { debounce, logger } from '../../global';
import { subscribePubSubMessage, TabSpaceMsg } from '../../message/message';
import { db } from '../../store/db';
import {
  getLocalStorageKey,
  localStorageAddListener,
  localStorageGetItem,
  localStoragePutItem,
  localStorageRemoveListener,
} from '../../store/localStorageWrapper';
import {
  addPagingToQueryParams,
  DEFAULT_SAVE_DEBOUNCE,
} from '../../store/store';
import { updateFromSaved } from '../Base';
import { isIdNotSaved } from '../common';
import { InSavingStatus } from '../storage/Storage';
import { getTabSpaceData } from '../tabSpace/bootstrap';
import {
  addNote,
  AllNote,
  AllNoteSavePayload,
  ALLNOTE_DB_TABLE_NAME,
  convertAndGetAllNoteSavePayload,
  newEmptyAllNote,
  updateTabSpaceId,
} from './AllNote';
import { Note, NoteLocalStorage, NOTE_DB_TABLE_NAME } from './Note';
import { $allNote, $noteStorage, noteStoreApi } from './store';

export const LOCALSTORAGE_NOTE_KEY = getLocalStorageKey('note');

export function monitorTabSpaceChanges() {
  subscribePubSubMessage(TabSpaceMsg.ChangeID, (message, data) => {
    logger.log('pubsub:', message, data);
    const { to } = data;
    noteStoreApi.updateTabSpaceId(to);
  });
}

export async function loadCurrentAllNoteFromLocalStorage() {
  return new Promise<void>((resolve, reject) =>
    localStorageGetItem(LOCALSTORAGE_NOTE_KEY, (value: string) => {
      const noteJSONs = JSON.parse(value) as NoteLocalStorage[];
      if (isArray(noteJSONs)) {
        noteStoreApi.restoreFromLocalStorageJSON(noteJSONs);
      }
      resolve();
    }),
  );
}

export async function loadAllNoteByTabSpaceId(tabSpaceId: string) {
  if (isIdNotSaved(tabSpaceId) && !isJestTest()) {
    await loadCurrentAllNoteFromLocalStorage();
  } else {
    const savedAllNote = await queryAllNote(
      tabSpaceId,
      addPagingToQueryParams({}),
    );
    noteStoreApi.update(savedAllNote);
    noteStoreApi.updateLastSavedTime(savedAllNote.updatedAt);
  }
}

export function startMonitorLocalStorageChanges() {
  localStorageAddListener(LOCALSTORAGE_NOTE_KEY, (key, newValue, oldValue) => {
    const noteJSONs = JSON.parse(newValue) as NoteLocalStorage[];
    noteStoreApi.restoreFromLocalStorageJSON(noteJSONs);
  });
  // immediately load once after the monitoring is started
  loadCurrentAllNoteFromLocalStorage();
}

export function stopMonitorLocalStorageChanges() {
  localStorageRemoveListener(LOCALSTORAGE_NOTE_KEY);
}

export function monitorAllNoteChanges() {
  $allNote.watch((currentAllNote) => {
    logger.log('allNote changed:', currentAllNote);
    if ($noteStorage.getState().inSaving === InSavingStatus.InSaving) {
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

function saveCurrentAllNoteToLocalStorage() {
  localStoragePutItem(
    LOCALSTORAGE_NOTE_KEY,
    JSON.stringify($allNote.getState()),
  );
}

export async function queryAllNote(
  tabSpaceId: string,
  params?: any,
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
    notesData.forEach((noteData) => (allNote = addNote(noteData, allNote)));
    return allNote;
  }
}
