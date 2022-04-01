import { IBase, setAttrForObject2 } from '../common';
import { inPlaceConvertToSaved, newEmptyBase } from '../Base';

import { NotTabSpaceId } from '../chromeSession/ChromeSession';
import { produce } from 'immer';

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
  return produce(targetNote, (_draft) => {});
}

export const setTabSpaceId = setAttrForObject2<string, Note>('tabSpaceId');

export const setName = setAttrForObject2<string, Note>('name');

export const setData = setAttrForObject2<string, Note>('data');

export function convertToSavedNote(targetNote: Note): Note {
  return produce(targetNote, (draft) => {
    inPlaceConvertToSaved(draft);
  });
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
