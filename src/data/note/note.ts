import { Base, IBase, isIdNotSaved } from '../common';
import { action, makeObservable, observable } from 'mobx';
import { extend, merge } from 'lodash';

import { List } from 'immutable';

export interface INote extends IBase {
  tabSpaceId: string;
  name: string;
  data: string;
}

export type INoteJSON = INote;
export type INoteSavePayload = INoteJSON;

export class Note extends Base implements INote {
  tabSpaceId: string;
  name: string;
  data: string;

  static DB_TABLE_NAME = 'SavedNote';
  static DB_SCHEMA = 'id, createdAt, name, tabSpaceId';

  constructor() {
    super();
    this.tabSpaceId = '';
    this.name = `Note ${Date.now()}`;
    this.data = '';
  }

  clone(): Note {
    const n = new Note();
    n.cloneAttributes(this);
    n.tabSpaceId = this.tabSpaceId;
    n.name = this.name;
    n.data = this.data;
    return n;
  }

  isEqualContent(otherNote?: Note, compareBase = false) {
    if (!otherNote) {
      return false;
    }
    let r = false;
    r =
      this.tabSpaceId === otherNote.tabSpaceId &&
      this.name === otherNote.name &&
      this.data === otherNote.data;
    if (compareBase) {
      r =
        r &&
        this.id === otherNote.id &&
        this.createdAt === otherNote.createdAt &&
        this.updatedAt === otherNote.updatedAt;
    }
    return r;
  }

  toJSON(): INoteJSON {
    return extend(super.toJSON(), {
      tabSpaceId: this.tabSpaceId,
      name: this.name,
      data: this.data,
    });
  }

  static fromJSON(d: INoteJSON): Note {
    const n = new Note();
    n.cloneAttributes(d);
    n.tabSpaceId = d.tabSpaceId;
    n.name = d.name;
    n.data = d.data;
    return n;
  }

  convertAndGetSavePayload(): INoteSavePayload {
    this.convertToSaved();
    return this.toJSON();
  }
}

export interface IAllNoteSavePayload extends IBase {
  tabSpaceId: string;
  noteIds: string[];
}

export class AllNote extends Base {
  tabSpaceId: string;
  notes: List<Note>;

  static DB_TABLE_NAME = 'SavedAllNote';
  static DB_SCHEMA = 'id, createdAt, tabSpaceId, *noteIds';

  constructor(tabSpaceId: string) {
    super();

    makeObservable(
      this,
      extend(Base.getMakeObservableDef(), {
        notes: observable,

        addNote: action,
        updateNote: action,
        removeNote: action,
        updateTabSpaceId: action,
        convertAndGetSavePayload: action,
      }),
    );

    this.tabSpaceId = tabSpaceId;
    this.notes = List();
  }

  clone() {
    const newAllNote = new AllNote(this.tabSpaceId);
    newAllNote.cloneAttributes(this);
    this.notes = List(this.notes);
    return newAllNote;
  }

  copy(otherAllNote: AllNote) {
    this.cloneAttributes(otherAllNote);
    this.notes = List(otherAllNote.notes);
    this.tabSpaceId = otherAllNote.tabSpaceId;
    return this;
  }

  findNoteIndex(id: string) {
    return this.notes.findIndex((note) => note.id === id);
  }

  addNote(n: Note) {
    n.tabSpaceId = this.tabSpaceId;
    this.notes = this.notes.push(n.clone().makeImmutable());
    return this;
  }

  updateNote(id: string, params: Partial<Note>): Note | null {
    const existNoteIndex = this.findNoteIndex(id);
    if (existNoteIndex >= 0) {
      const existNote = this.notes.get(existNoteIndex);
      const newNote = existNote.clone();
      merge(newNote, params);
      this.notes = this.notes.set(existNoteIndex, newNote.makeImmutable());
      return newNote;
    }
    return null;
  }

  removeNote(id: string): Note | null {
    const existNoteIndex = this.findNoteIndex(id);
    if (existNoteIndex >= 0) {
      const existNote = this.notes.get(existNoteIndex);
      this.notes = this.notes.remove(existNoteIndex);
      return existNote;
    }
    return null;
  }

  updateTabSpaceId(newTabSpaceId: string) {
    this.tabSpaceId = newTabSpaceId;
    this.notes = List(
      this.notes.map((note) => {
        const newNote = note.clone();
        newNote.tabSpaceId = newTabSpaceId;
        return newNote.makeImmutable();
      }),
    );
    return this;
  }

  static fromSavedData(data: IAllNoteSavePayload) {
    const allNote = new AllNote(data.tabSpaceId);
    allNote.cloneAttributes(data);
    return allNote;
  }

  convertAndGetSavePayload(): {
    allNoteSavePayload: IAllNoteSavePayload;
    isNewAllNote: boolean;
    newNoteSavePayloads: INoteSavePayload[];
    existNoteSavePayloads: INoteSavePayload[];
  } {
    const isNewAllNote = isIdNotSaved(this.id);
    this.convertToSaved();
    const newNoteSavePayloads: INoteSavePayload[] = [];
    const existNoteSavePayloads: INoteSavePayload[] = [];
    this.notes = List(
      this.notes.map((note) => {
        const savedNote = note.clone();
        const isNewNote = isIdNotSaved(note.id);
        const noteSavePayload = savedNote.convertAndGetSavePayload();
        if (isNewNote) {
          newNoteSavePayloads.push(noteSavePayload);
        } else {
          existNoteSavePayloads.push(noteSavePayload);
        }
        return savedNote.makeImmutable();
      }),
    );
    return {
      allNoteSavePayload: extend(super.toJSON(), {
        tabSpaceId: this.tabSpaceId,
        noteIds: this.notes.map((note) => note.id).toArray(),
      }),
      isNewAllNote,
      newNoteSavePayloads,
      existNoteSavePayloads,
    };
  }
}
