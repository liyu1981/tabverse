import { createApi, createStore } from 'effector';

export enum InSavingStatus {
  InSaving = 0,
  Idle = 1,
}

export interface GeneralStorage {
  inSaving: InSavingStatus;
  savedDataVersion: number;
  totalSavedCount: number;
  lastSavedTime: number;
}

export function newEmptyGeneralStorage(): GeneralStorage {
  return {
    inSaving: InSavingStatus.Idle,
    savedDataVersion: 0,
    totalSavedCount: 0,
    lastSavedTime: 0,
  };
}

export function updateTotalSavedCount(
  totalSavedCount: number,
  targetStorage: GeneralStorage,
): GeneralStorage {
  return { ...targetStorage, totalSavedCount };
}

export function increaseSavedDataVersion(
  targetStorage: GeneralStorage,
): GeneralStorage {
  return {
    ...targetStorage,
    savedDataVersion: targetStorage.savedDataVersion + 1,
  };
}

export function markInSaving(
  inSaving: boolean,
  targetStorage: GeneralStorage,
): GeneralStorage {
  return {
    ...targetStorage,
    inSaving: inSaving ? InSavingStatus.InSaving : InSavingStatus.Idle,
  };
}

export function updateLastSavedTime(
  lastSavedTime: number,
  targetStorage: GeneralStorage,
): GeneralStorage {
  return { ...targetStorage, lastSavedTime };
}

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
