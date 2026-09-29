import { createApi, createStore, forward } from 'effector';
import { merge } from 'lodash';
import { exposeDebugData } from '../../debug';
import { createGeneralStorageStoreAndApi } from '../../storage/GeneralStorage';
import { storageOverviewApi } from '../../storage/StorageOverview';
import {
  addClosedTab,
  AllClosedTab,
  clearClosedTabs,
  newEmptyAllClosedTab,
  removeClosedTab,
  updateClosedTab,
  updateTabSpaceId,
} from './AllClosedTab';
import { ClosedTab } from './ClosedTab';

export const $allClosedTab = createStore<AllClosedTab>(newEmptyAllClosedTab());

const allClosedTabApi = createApi($allClosedTab, {
  update: (_last, updated: AllClosedTab) => updated,
  updateTabSpaceId: (last, newTabSpaceId: string) =>
    updateTabSpaceId(newTabSpaceId, last),
  addClosedTab: (last, closedTab: ClosedTab) => addClosedTab(closedTab, last),
  updateClosedTab: (
    last,
    { tid, changes }: { tid: string; changes: Partial<ClosedTab> },
  ) => updateClosedTab(tid, changes, last),
  removeClosedTab: (last, tid: string) => removeClosedTab(tid, last),
  clearClosedTabs: (last) => clearClosedTabs(last),
});

const { $store: $closedTabStorageStoreImpl, api: closedTabStorageApi } =
  createGeneralStorageStoreAndApi();
export const $closedTabStorage = $closedTabStorageStoreImpl;

forward({
  from: $closedTabStorage,
  to: storageOverviewApi.updateClosedTabStorage,
});

export const closedTabStoreApi = merge(allClosedTabApi, closedTabStorageApi);

exposeDebugData('closedTab', {
  $allClosedTab,
  $closedTabStorage,
  closedTabStoreApi,
});
