import { createApi, createStore } from 'effector';
import {
  GeneralStorage,
  increaseSavedDataVersion,
  markInSaving,
  newEmptyGeneralStorage,
  updateLastSavedTime,
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
  });
  return { $store, api };
}
