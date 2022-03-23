import { List } from 'immutable';
import { convertToSavedBase, newEmptyBase } from '../Base';
import { NotTabSpaceId } from '../chromeSession/ChromeSession';
import { IBase, isIdNotSaved } from '../common';
import {
  convertToSavedNote,
  newEmptyNote,
  Note,
  NoteLocalStorage,
  setTabSpaceId,
} from './Note';

export interface AllNote extends IBase {
  tabSpaceId: string;
  notes: List<Note>;
}

export interface AllNoteSavePayload extends IBase {
  tabSpaceId: string;
  noteIds: string[];
}

export const ALLNOTE_DB_TABLE_NAME = 'SavedAllNote';
export const ALLNOTE_DB_SCHEMA = 'id, createdAt, tabSpaceId, *noteIds';

export function newEmptyAllNote(): AllNote {
  return {
    ...newEmptyBase(),
    tabSpaceId: NotTabSpaceId,
    notes: List(),
  };
}

export function cloneAllNote(targetAllNote: AllNote): AllNote {
  return {
    ...targetAllNote,
    notes: List(targetAllNote.notes),
  };
}

export function addNote(note: Note, targetAllNote: AllNote): AllNote {
  return {
    ...targetAllNote,
    notes: targetAllNote.notes.push(
      setTabSpaceId(targetAllNote.tabSpaceId, note),
    ),
  };
}

export function updateNote(
  id: string,
  changes: Partial<Note>,
  targetAllNote: AllNote,
): AllNote {
  const nIndex = targetAllNote.notes.findIndex((note) => note.id === id);
  if (nIndex >= 0) {
    const existNote = targetAllNote.notes.get(nIndex);
    const newNote = { ...existNote, ...changes };
    return {
      ...targetAllNote,
      notes: targetAllNote.notes.set(nIndex, newNote),
    };
  } else {
    return cloneAllNote(targetAllNote);
  }
}

export function removeNote(id: string, targetAllNote: AllNote): AllNote {
  const nIndex = targetAllNote.notes.findIndex((note) => note.id === id);
  if (nIndex >= 0) {
    return {
      ...targetAllNote,
      notes: targetAllNote.notes.remove(nIndex),
    };
  } else {
    return cloneAllNote(targetAllNote);
  }
}

export function updateTabSpaceId(
  tabSpaceId: string,
  targetAllNote: AllNote,
): AllNote {
  return {
    ...targetAllNote,
    tabSpaceId,
    notes: targetAllNote.notes
      .map((note) => setTabSpaceId(tabSpaceId, note))
      .toList(),
  };
}

export function getLocalStorageJSON(
  targetAllNote: AllNote,
): NoteLocalStorage[] {
  return targetAllNote.notes
    .map((note) => {
      return { name: note.name, data: note.data };
    })
    .toArray();
}

export function restoreFromLocalStorageJSON(
  noteJSONs: NoteLocalStorage[],
  targetAllNote: AllNote,
): AllNote {
  return {
    ...targetAllNote,
    notes: List(
      noteJSONs.map((noteJSON) => ({
        ...newEmptyNote(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        name: noteJSON.name,
        data: noteJSON.data,
      })),
    ),
  };
}

export function convertAndGetAllNoteSavePayload(targetAllNote: AllNote): {
  allNote: AllNote;
  allNoteSavePayload: AllNoteSavePayload;
  isNewAllNote: boolean;
  newNoteSavePayloads: Note[];
  existNoteSavePayloads: Note[];
} {
  const isNewAllNote = isIdNotSaved(targetAllNote.id);
  const newNoteSavePayloads: Note[] = [];
  const existNoteSavePayloads: Note[] = [];
  const savedNotes = targetAllNote.notes
    .map((note) => {
      const isNewNote = isIdNotSaved(note.id);
      const savedNote = convertToSavedNote(note);
      if (isNewNote) {
        newNoteSavePayloads.push(savedNote);
      } else {
        existNoteSavePayloads.push(savedNote);
      }
      return savedNote;
    })
    .toList();
  const savedAllNote = {
    ...targetAllNote,
    ...convertToSavedBase(targetAllNote),
    notes: savedNotes,
  };
  const allNoteSavePayload = {
    ...convertToSavedBase(targetAllNote),
    tabSpaceId: targetAllNote.tabSpaceId,
    noteIds: savedNotes.map((note) => note.id).toArray(),
  };
  return {
    allNote: savedAllNote,
    allNoteSavePayload,
    isNewAllNote,
    newNoteSavePayloads,
    existNoteSavePayloads,
  };
}
