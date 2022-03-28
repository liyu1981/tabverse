import { createApi, createStore } from 'effector';
import {
  GeneralStorage,
  increaseSavedDataVersion,
  markInSaving,
  newEmptyGeneralStorage,
  updateLastSavedTime,
  updateTotalSavedCount,
} from './Storage';

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
