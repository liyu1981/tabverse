import { IBase, getSavedId, getUnsavedNewId } from './common';

import { TABSPACE_DB_VERSION } from '../global';

export const NotId = '-1';

export function newEmptyBase(): IBase {
  return {
    version: TABSPACE_DB_VERSION,
    createdAt: -1,
    updatedAt: -1,
    id: getUnsavedNewId(),
  };
}

export function convertToSavedBase(targetBase: IBase): IBase {
  const datenow = Date.now();
  return {
    ...targetBase,
    id: getSavedId(targetBase.id),
    createdAt: targetBase.createdAt < 0 ? datenow : targetBase.createdAt,
    updatedAt: datenow,
  };
}

export function updateFromSaved<T1 extends IBase, T2 extends IBase>(
  saved: T1,
  target: T2,
): T2 {
  return {
    ...target,
    version: saved.version,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
    id: saved.id,
  };
}
