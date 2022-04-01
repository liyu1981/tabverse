import { createApi, createStore } from 'effector';
import { forEach, map } from 'lodash';

import {
  GeneralStorage,
  increaseSavedDataVersion,
  InSavingStatus,
  markInSaving,
  newEmptyGeneralStorage,
  updateLastSavedTime,
  updateTotalSavedCount,
} from './GeneralStorage';

export const DEFAULT_SAVE_DEBOUNCE = 1000;

export function createGeneralStorageStoreAndApi() {
  const $store = createStore<GeneralStorage>(newEmptyGeneralStorage());
  const api = createApi($store, {
    increaseSavedDataVersion: (lastStorage) =>
      increaseSavedDataVersion(lastStorage),
    markInSaving: (lastStorage, inSaving: boolean) =>
      markInSaving(inSaving, lastStorage),
    updateLastSavedTime: (lastStorage, lastSavedTime: number) =>
      updateLastSavedTime(lastSavedTime, lastStorage),
    updateTotalSavedCount: (lastStorage, totalSavedCount: number) =>
      updateTotalSavedCount(totalSavedCount, lastStorage),
  });
  return { $store, api };
}

export class StorageOverview {
  storages: { [k: string]: GeneralStorage };

  constructor(storages: { [k: string]: GeneralStorage }) {
    this.storages = storages;
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
    forEach(this.storages, (storage) => {
      if (!last) {
        last = storage;
      } else {
        if (storage.lastSavedTime >= last.lastSavedTime) {
          last = storage;
        }
      }
    });
    return last;
  }

  getAllLastSavedTime(): [string, number][] {
    return map(this.storages, (storage, key) => [key, storage.lastSavedTime]);
  }
}

export const $storageOverview = createStore(new StorageOverview({}));
export const storageOverviewApi = createApi($storageOverview, {
  updateTabSpaceStorage: (lastStorageOverviewApi, tabSpaceStorage) => {
    return new StorageOverview({
      ...lastStorageOverviewApi.storages,
      tabverse: tabSpaceStorage,
    });
  },
  updateNoteStorage: (lastStorageOverviewApi, noteStorage) => {
    return new StorageOverview({
      ...lastStorageOverviewApi.storages,
      note: noteStorage,
    });
  },
  updateTodoStorage: (lastStorageOverviewApi, todoStorage) => {
    return new StorageOverview({
      ...lastStorageOverviewApi.storages,
      note: todoStorage,
    });
  },
  updateBookmarkStorage: (lastStorageOverviewApi, bookmarkStorage) => {
    return new StorageOverview({
      ...lastStorageOverviewApi.storages,
      note: bookmarkStorage,
    });
  },
});
