import { IBase } from '../common';
import { Note, convertToSavedNote, setTabSpaceId } from './Note';
import {
  convertToSavedBase,
  inPlaceCopyFromOtherBase,
  newEmptyBase,
} from '../Base';

import { List } from 'immutable';
import { NotTabSpaceId } from '../common';
import { produce } from 'immer';

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

export function addNote(note: Note, targetAllNote: AllNote): AllNote {
  return produce(targetAllNote, (draft) => {
    draft.notes = draft.notes.push(
      setTabSpaceId(targetAllNote.tabSpaceId, note),
    );
  });
}

export function updateNote(
  id: string,
  changes: Partial<Note>,
  targetAllNote: AllNote,
): AllNote {
  return produce(targetAllNote, (draft) => {
    const nIndex = draft.notes.findIndex((note) => note.id === id);
    if (nIndex >= 0) {
      const existNote = targetAllNote.notes.get(nIndex);
      const newNote = { ...existNote, ...changes };
      draft.notes = draft.notes.set(nIndex, newNote);
    }
  });
}

export function removeNote(id: string, targetAllNote: AllNote): AllNote {
  return produce(targetAllNote, (draft) => {
    const nIndex = draft.notes.findIndex((note) => note.id === id);
    if (nIndex >= 0) {
      draft.notes = draft.notes.remove(nIndex);
    }
  });
}

export function updateTabSpaceId(
  tabSpaceId: string,
  targetAllNote: AllNote,
): AllNote {
  return produce(targetAllNote, (draft) => {
    draft.tabSpaceId = tabSpaceId;
    draft.notes = draft.notes
      .map((note) => setTabSpaceId(tabSpaceId, note))
      .toList();
  });
}

export function convertAndGetAllNoteSavePayload(targetAllNote: AllNote): {
  allNote: AllNote;
  allNoteSavePayload: AllNoteSavePayload;
  noteSavePayloads: Note[];
} {
  const savedNotes = targetAllNote.notes.map(convertToSavedNote).toList();
  const savedBase = convertToSavedBase(targetAllNote);
  const savedAllNote = produce(targetAllNote, (draft) => {
    inPlaceCopyFromOtherBase(draft, savedBase);
    draft.notes = savedNotes;
  });
  const allNoteSavePayload = {
    ...savedBase,
    tabSpaceId: targetAllNote.tabSpaceId,
    noteIds: savedNotes.map((note) => note.id).toArray(),
  };
  return {
    allNote: savedAllNote,
    allNoteSavePayload,
    noteSavePayloads: savedNotes.toArray(),
  };
}
