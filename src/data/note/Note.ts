import { convertToSavedBase, newEmptyBase } from '../Base';
import { NotTabSpaceId } from '../chromeSession/ChromeSession';
import { IBase } from '../common';

export interface Note extends IBase {
  tabSpaceId: string;
  name: string;
  data: string;
}

export type NoteLocalStorage = Pick<Note, 'name' | 'data'>;

export const NOTE_DB_TABLE_NAME = 'SavedNote';
export const NOTE_DB_SCHEMA = 'id, createdAt, name, tabSpaceId';

export function newEmptyNote(): Note {
  return {
    ...newEmptyBase(),
    tabSpaceId: NotTabSpaceId,
    name: `Note ${Date.now()}`,
    data: '',
  };
}

export function cloneNote(targetNote: Note): Note {
  return { ...targetNote };
}

export function setTabSpaceId(tabSpaceId: string, targetNote: Note): Note {
  return { ...targetNote, tabSpaceId };
}

export function setName(name: string, targetNote: Note): Note {
  return { ...targetNote, name };
}

export function setData(data: string, targetNote: Note): Note {
  return { ...targetNote, data };
}

export function convertToSavedNote(targetNote: Note): Note {
  return {
    ...targetNote,
    ...convertToSavedBase(targetNote),
  };
}

export function isEqualContent(
  thisNote: Note,
  otherNote?: Note,
  compareBase = false,
): boolean {
  if (!otherNote) {
    return false;
  }
  let r = false;
  r =
    thisNote.tabSpaceId === otherNote.tabSpaceId &&
    thisNote.name === otherNote.name &&
    thisNote.data === otherNote.data;
  if (compareBase) {
    r =
      r &&
      thisNote.id === otherNote.id &&
      thisNote.createdAt === otherNote.createdAt &&
      thisNote.updatedAt === otherNote.updatedAt;
  }
  return r;
}
