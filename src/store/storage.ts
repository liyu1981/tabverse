import { forEach, map, merge } from 'lodash';

import { GeneralStorage } from '../data/storage/Storage';

export const DEFAULT_SAVE_DEBOUNCE = 1000;
export const QUERY_PAGE_LIMIT_DEFAULT = 10; // 2;

export enum InSavingStatus {
  InSaving = 0,
  Idle = 1,
}

export class StorageManager {
  storages: { [k: string]: GeneralStorage };

  constructor() {
    this.storages = {};
  }

  addSavedStorage(k: string, ss: GeneralStorage) {
    this.storages[k] = ss;
  }

  anyStorageInSaving(): [boolean, string[]] {
    let anyInSaving = false;
    const whoIsInSaving = [];
    for (const key of Object.keys(this.storages)) {
      if (this.storages[key].inSaving === InSavingStatus.InSaving) {
        anyInSaving = true;
        whoIsInSaving.push(key);
      }
    }
    return anyInSaving ? [true, whoIsInSaving] : [false, []];
  }

  getLastSavedStorage(): GeneralStorage {
    let last = null;
    forEach(this.storages, (savedStore) => {
      if (!last) {
        last = savedStore;
      } else {
        if (savedStore.lastSavedTime >= last.lastSavedTime) {
          last = savedStore;
        }
      }
    });
    return last;
  }

  getAllLastSavedTime(): [string, number][] {
    return map(this.storages, (savedStore, key) => [
      key,
      savedStore.lastSavedTime,
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
