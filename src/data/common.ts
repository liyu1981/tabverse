import { action, observable } from 'mobx';

import { TABSPACE_DB_VERSION } from '../global';
import { nanoid } from 'nanoid';

export function getUnsavedNewId() {
  // use 11 chars, as calculated by the estimator
  // (https://zelark.github.io/nano-id-cc/) this will result in ~1 thousand
  // years needed, in order to have a 1% probability of at least one collision
  // for 100 ids per hour.
  return `~${nanoid(11)}`;
}

export function getNewId() {
  return nanoid(11);
}

export function getSavedId(unsavedId: string) {
  if (isIdNotSaved(unsavedId)) {
    // just remove the leading ~
    return unsavedId.substr(1);
  } else {
    // actually it is saved
    return unsavedId;
  }
}

export function isIdNotSaved(id: string) {
  // simple: unsaved one starts with ~ which is not in the alphabet of nanoid
  return id.startsWith('~');
}

export interface IBase {
  version: number;
  id: string;
  createdAt: number;
  updatedAt: number;
}

export class Base implements IBase {
  version: number;
  id: string;
  createdAt: number;
  updatedAt: number;

  constructor(newId?: string) {
    this.version = TABSPACE_DB_VERSION;
    this.createdAt = -1;
    this.updatedAt = -1;
    this.id = newId ?? getUnsavedNewId();
  }

  static getMakeObservableDef(): {
    [k: string]: typeof observable | typeof action;
  } {
    return {
      id: observable,
      version: observable,
      createdAt: observable,
      updatedAt: observable,

      convertToSaved: action,
    };
  }

  cloneAttributes(other: IBase) {
    this.id = other.id;
    this.version = other.version;
    this.createdAt = other.createdAt;
    this.updatedAt = other.updatedAt;
  }

  convertToSaved() {
    this.id = getSavedId(this.id);
    const datenow = Date.now();
    this.createdAt = this.createdAt < 0 ? datenow : this.createdAt;
    this.updatedAt = datenow;
    return this;
  }

  toJSON() {
    return {
      id: this.id,
      version: this.version,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  makeImmutable() {
    Object.freeze(this);
    return this;
  }
}
