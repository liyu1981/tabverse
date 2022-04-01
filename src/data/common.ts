import { nanoid } from 'nanoid';
import { produce } from 'immer';

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

export function setAttrForObject2<T1 = any, T2 = any>(
  attrName: string,
): (value: T1, target: T2) => T2 {
  return (value: T1, target: T2) => {
    return produce(target, (draft) => {
      draft[attrName] = value;
    });
  };
}

export function setAttrForObject<T1, T2>(
  attrName: string,
  value: T1,
  target: T2,
): T2 {
  return produce(target, (draft) => {
    draft[attrName] = value;
  });
}
