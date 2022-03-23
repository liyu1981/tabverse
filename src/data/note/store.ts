import {
  addNote,
  AllNote,
  newEmptyAllNote,
  removeNote,
  restoreFromLocalStorageJSON,
  updateNote,
  updateTabSpaceId,
} from './AllNote';
import { createApi, createStore } from 'effector';
import { merge } from 'lodash';
import { Note, NoteLocalStorage } from './Note';
import { createGeneralStorageStoreAndApi } from '../storage/store';
import { exposeDebugData } from '../../debug';

export const $allNote = createStore<AllNote>(newEmptyAllNote());
export type AllNoteStore = typeof $allNote;

const allNoteApi = createApi($allNote, {
  update: (lastAllNote, updatedAllNote: AllNote) => updatedAllNote,
  addNote: (lastAllNote, note: Note) => addNote(note, lastAllNote),
  updateNote: (
    lastAllNote,
    { nid, changes }: { nid: string; changes: Partial<Note> },
  ) => updateNote(nid, changes, lastAllNote),
  removeNote: (lastAllNote, nid: string) => removeNote(nid, lastAllNote),
  updateTabSpaceId: (lastAllNote, tabSpaceId: string) =>
    updateTabSpaceId(tabSpaceId, lastAllNote),
  restoreFromLocalStorageJSON: (lastAllNote, noteJSONs: NoteLocalStorage[]) =>
    restoreFromLocalStorageJSON(noteJSONs, lastAllNote),
});

const { $store: $noteStorageStore, api: noteStorageApi } =
  createGeneralStorageStoreAndApi();
export const $noteStorage = $noteStorageStore;
export type NoteStorageStore = typeof $noteStorageStore;

export const noteStoreApi = merge(allNoteApi, noteStorageApi);
export type NoteStoreApi = typeof noteStorageApi;

exposeDebugData('note', { $allNote, $noteStorageStore });
