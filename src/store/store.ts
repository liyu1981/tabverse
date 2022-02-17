import { BackgroundMsg, sendChromeMessage } from '../message';
import { action, makeObservable, observable } from 'mobx';
import { forEach, map, merge } from 'lodash';

import { logger } from '../global';

export const DEFAULT_SAVE_DEBOUNCE = 1000;

export enum InSavingStatus {
  InSaving = 0,
  Idle = 1,
}

export class SavedStore {
  inSaving: InSavingStatus;
  savedDataVersion: number;
  totalSavedCount: number;
  lastSavedTime: number;

  constructor() {
    makeObservable(this, {
      inSaving: observable,
      savedDataVersion: observable,
      totalSavedCount: observable,

      updateTotalSavedCount: action,
      increaseSavedDataVersion: action,
      markInSaving: action,
      updateLastSavedTime: action,
    });

    this.inSaving = InSavingStatus.Idle;
    this.savedDataVersion = 0;
    this.totalSavedCount = 0;
    this.lastSavedTime = 0;
  }

  updateTotalSavedCount(total: number) {
    this.totalSavedCount = total;
  }

  increaseSavedDataVersion() {
    this.savedDataVersion += 1;
  }

  markInSaving(inSaving: boolean, lastSavedTime?: number) {
    this.inSaving = inSaving ? InSavingStatus.InSaving : InSavingStatus.Idle;
    this.updateLastSavedTime(lastSavedTime);
  }

  updateLastSavedTime(lastSavedTime?: number) {
    this.lastSavedTime = lastSavedTime;
  }
}

export class SavedStoreManager {
  savedStores: { [k: string]: SavedStore };

  constructor() {
    this.savedStores = {};
  }

  addSavedStore(k: string, ss: SavedStore) {
    this.savedStores[k] = ss;
  }

  anyStoreInSaving(): [boolean, string[]] {
    let anyInSaving = false;
    const whoIsInSaving = [];
    for (const key of Object.keys(this.savedStores)) {
      if (this.savedStores[key].inSaving === InSavingStatus.InSaving) {
        anyInSaving = true;
        whoIsInSaving.push(key);
      }
    }
    return anyInSaving ? [true, whoIsInSaving] : [false, []];
  }

  getLastSavedStore(): SavedStore {
    let last = null;
    forEach(this.savedStores, (savedStore) => {
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
    return map(this.savedStores, (savedStore, key) => [
      key,
      savedStore.lastSavedTime,
    ]);
  }
}

export const QUERY_PAGE_LIMIT_DEFAULT = 10;

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

const dbAuditors = [];

export type DbAuditor = (logs: string[]) => Promise<void>;

export const getLogger = (logs: string[]) => (msg: string) => {
  logger.info(msg);
  logs.push(msg);
};

export function registerDbAuditor(dbAuditor: DbAuditor): void {
  dbAuditors.push(dbAuditor);
}

export async function dbAuditAndClearance() {
  const logs: string[] = [];
  await Promise.all(map(dbAuditors, (dbAuditor: DbAuditor) => dbAuditor(logs)));
  sendChromeMessage({
    type: BackgroundMsg.AuditComplete,
    payload: logs,
  });
}
