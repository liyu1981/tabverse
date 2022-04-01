import { IBase, getSavedId, getUnsavedNewId } from './common';

import { TABSPACE_DB_VERSION } from '../global';
import { produce } from 'immer';

export const NotId = '-1';

export function newEmptyBase(): IBase {
  return {
    version: TABSPACE_DB_VERSION,
    createdAt: -1,
    updatedAt: -1,
    id: getUnsavedNewId(),
  };
}

export function toBase<T extends IBase>(target: T): IBase {
  return {
    version: target.version,
    createdAt: target.createdAt,
    updatedAt: target.updatedAt,
    id: target.id,
  };
}

export function convertToSavedBase(targetBase: IBase): IBase {
  return produce(toBase(targetBase), (draft) => {
    const datenow = Date.now();
    draft.createdAt = targetBase.createdAt < 0 ? datenow : targetBase.createdAt;
    draft.updatedAt = datenow;
    draft.id = getSavedId(targetBase.id);
  });
}

export function inPlaceConvertToSaved<T extends IBase>(target: T) {
  const datenow = Date.now();
  target.createdAt = target.createdAt < 0 ? datenow : target.createdAt;
  target.updatedAt = datenow;
  target.id = getSavedId(target.id);
}

export function updateFromSaved<T1 extends IBase, T2 extends IBase>(
  saved: T1,
  target: T2,
): T2 {
  return produce(target, (draft) => {
    draft.version = saved.version;
    draft.createdAt = saved.createdAt;
    draft.updatedAt = saved.updatedAt;
    draft.id = saved.id;
  });
}
