import { IBase, setAttrForObject2 } from '../common';
import { inPlaceConvertToSaved, newEmptyBase } from '../Base';

import { NotTabSpaceId } from '../common';
import { produce } from 'immer';

export interface Note extends IBase {
  tabSpaceId: string;
  name: string;
  data: string;
  /**
   * Whether the editor is folded shut. It is the note's own state rather than
   * page state, so a refresh keeps the fold.
   */
  collapsed?: boolean;
}

export const NOTE_DB_TABLE_NAME = 'SavedNote';
export const NOTE_DB_SCHEMA = 'id, createdAt, name, tabSpaceId';

export function newEmptyNote(): Note {
  return {
    ...newEmptyBase(),
    tabSpaceId: NotTabSpaceId,
    name: `Note ${Date.now()}`,
    data: '',
    collapsed: false,
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
  let r =
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
