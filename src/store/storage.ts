import { Store } from 'effector';
import { forEach, map, merge } from 'lodash';

import { GeneralStorage } from '../data/storage/Storage';

export const DEFAULT_SAVE_DEBOUNCE = 1000;
export const QUERY_PAGE_LIMIT_DEFAULT = 10; // 2;

export enum InSavingStatus {
  InSaving = 0,
  Idle = 1,
}

export class StorageManager {
  storages: { [k: string]: Store<GeneralStorage> };

  constructor() {
    this.storages = {};
  }

  addStorage(k: string, ss: Store<GeneralStorage>) {
    this.storages[k] = ss;
  }

  anyStorageInSaving(): [boolean, string[]] {
    let anyInSaving = false;
    const whoIsInSaving = [];
    for (const key of Object.keys(this.storages)) {
      if (this.storages[key].getState().inSaving === InSavingStatus.InSaving) {
        anyInSaving = true;
        whoIsInSaving.push(key);
      }
    }
    return anyInSaving ? [true, whoIsInSaving] : [false, []];
  }

  getLastSavedStorage(): GeneralStorage {
    let last = null;
    forEach(this.storages, (storage) => {
      if (!last) {
        last = storage;
      } else {
        if (storage.getState().lastSavedTime >= last.lastSavedTime) {
          last = storage;
        }
      }
    });
    return last;
  }

  getAllLastSavedTime(): [string, number][] {
    return map(this.storages, (storage, key) => [
      key,
      storage.getState().lastSavedTime,
    ]);
  }
}

export function addPagingToQueryParams(
  params: any,
  start?: number,
  limit?: number,
) {
  return merge(params, {
    pageStart: start ?? 0,
    pageLimit: limit ?? QUERY_PAGE_LIMIT_DEFAULT,
  });
}
