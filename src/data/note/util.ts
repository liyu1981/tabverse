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
import { NOTE_DB_TABLE_NAME, Note, NoteLocalStorage } from './Note';
import { TabSpaceMsg, subscribePubSubMessage } from '../../message/message';
import { addPagingToQueryParams, db } from '../../storage/db';
import { debounce, logger } from '../../global';
import {
  getLocalStorageKey,
  localStorageAddListener,
  localStorageGetItem,
  localStoragePutItem,
  localStorageRemoveListener,
} from '../../storage/localStorageWrapper';

import { $tabSpace } from '../tabSpace/store';
import { DEFAULT_SAVE_DEBOUNCE } from '../../storage/StorageOverview';
import { isArray } from 'lodash';
import { isIdNotSaved } from '../common';
import { isJestTest } from '../../debug';
import { needAutoSave } from '../tabSpace/TabSpace';
import { updateFromSaved } from '../Base';

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
  localStorageAddListener(LOCALSTORAGE_NOTE_KEY, (key, newValue, _oldValue) => {
    const noteJSONs = JSON.parse(newValue) as NoteLocalStorage[];
    noteStoreApi.restoreFromLocalStorageJSON(noteJSONs);
  });
  // immediately load once after the monitoring is started
  loadCurrentAllNoteFromLocalStorage();
}

export function stopMonitorLocalStorageChanges() {
  localStorageRemoveListener(LOCALSTORAGE_NOTE_KEY);
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

export const saveCurrentAllNoteIfNeeded = () => {
  if (needAutoSave($tabSpace.getState())) {
    logger.log('current tabSpace need autoSave, will then saveCurrentAllNote');
    saveCurrentAllNote();
  } else {
    logger.log(
      'current tabSpace is not on autoSave, will then save notes to localStorage',
    );
    saveCurrentAllNoteToLocalStorage();
  }
};

function saveCurrentAllNoteToLocalStorage() {
  localStoragePutItem(
    LOCALSTORAGE_NOTE_KEY,
    JSON.stringify($allNote.getState()),
  );
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
    notesData.forEach((noteData) => (allNote = addNote(noteData, allNote)));
    return allNote;
  }
}
