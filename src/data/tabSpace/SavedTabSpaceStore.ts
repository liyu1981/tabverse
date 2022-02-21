import {
  DEFAULT_SAVE_DEBOUNCE,
  InSavingStatus,
  QUERY_PAGE_LIMIT_DEFAULT,
  SavedStore,
} from '../../store/store';
import { ISavedTab, Tab } from './Tab';
import { ISavedTabSpace, TabSpace } from './TabSpace';
import { ITabSpaceData, getTabSpaceData } from './bootstrap';
import {
  TabSpaceDBMsg,
  TabSpaceMsg,
  sendPubSubMessage,
  subscribePubSubMessage,
} from '../../message';
import {
  addTabSpaceToIndex,
  removeTabSpaceFromIndex,
} from '../../background/fullTextSearch/api';
import {
  debounce,
  hasOwnProperty,
  logger,
  perfEnd,
  perfStart,
} from '../../global';

import { IDatabaseChange } from 'dexie-observable/api';
import { db } from '../../store/db';
import { observe } from 'mobx';
import { updateTabSpace as tabSpaceRegistryUpdateTabSpace } from '../../service/tabSpaceRegistry';

export class SavedTabSpaceStore extends SavedStore {
  async querySavedTabSpaceCount() {
    const total = await db.table(TabSpace.DB_TABLE_NAME).count();
    this.updateTotalSavedCount(total);
  }
}

export function monitorDbChanges(savedStore: SavedTabSpaceStore) {
  subscribePubSubMessage(
    TabSpaceDBMsg.Changed,
    (message, data: IDatabaseChange[]) => {
      logger.log('pubsub:', message, data);
      data.forEach((d) => {
        if (
          d.table === TabSpace.DB_TABLE_NAME ||
          d.table === Tab.DB_TABLE_NAME
        ) {
          savedStore.increaseSavedDataVersion();
          savedStore.querySavedTabSpaceCount();
        }
      });
    },
  );
}

export function monitorTabSpaceChange(tabSpaceData: ITabSpaceData) {
  const { tabSpace, savedTabSpaceStore } = tabSpaceData;
  observe(tabSpace, (change) => {
    logger.log('tabSpace changed:', change);
    if (savedTabSpaceStore.inSaving === InSavingStatus.InSaving) {
      logger.log('in saving, skip');
    } else {
      if (tabSpace.needAutoSave()) {
        logger.log(
          'current tabSpace need autoSave, will then saveCurrentTabSpace',
        );
        saveCurrentTabSpace();
      }
    }
  });
}

export interface IQuerySavedTabSpaceParams {
  anyOf?: string[];
  noneOf?: string[];
  pageStart?: number;
  pageLimit?: number;
}

export async function querySavedTabSpace(
  params?: IQuerySavedTabSpaceParams,
): Promise<TabSpace[]> {
  perfStart('query table space');
  let savedData: ISavedTabSpace[] = [];
  const pageStart = params?.pageStart ?? 0;
  const pageLimit = params?.pageLimit ?? QUERY_PAGE_LIMIT_DEFAULT;

  if (hasOwnProperty(params, 'anyOf')) {
    savedData = await db
      .table<ISavedTabSpace>(TabSpace.DB_TABLE_NAME)
      .bulkGet(params.anyOf);
    savedData.sort((d1, d2) => d2.createdAt - d1.createdAt);
    // savedDataQuery = savedDataQuery.filter((entry) => {
    //   return params.anyOf.findIndex((id) => id === entry.id) >= 0;
    // });
    savedData = savedData.slice(
      pageStart * pageLimit,
      (pageStart + 1) * pageLimit,
    );
  } else if (hasOwnProperty(params, 'noneOf')) {
    savedData = (
      await db
        .table<ISavedTabSpace>(TabSpace.DB_TABLE_NAME)
        .where('id')
        .noneOf(params.noneOf)
        .sortBy('createdAt')
    ).reverse();
  } else {
    const savedDataQuery = db
      .table<ISavedTabSpace>(TabSpace.DB_TABLE_NAME)
      .where('createdAt')
      .above(0)
      //.orderBy('createdAt')
      .reverse()
      .offset(pageStart)
      .limit(pageLimit);
    savedData = await savedDataQuery.toArray();
    //savedData = savedData.slice(pageStart * pageLimit, pageLimit);
  }
  perfEnd('query table space');

  perfStart('query tabids for tabspaces');
  // performance optimization to bulk load all tabs of tabSpaces then distribute
  const toLoadTabIds = savedData.reduce<string[]>((s, data) => {
    return s.concat(data.tabIds);
  }, []);
  const savedTabs = await db
    .table<ISavedTab>(Tab.DB_TABLE_NAME)
    .bulkGet(toLoadTabIds);
  const savedTabSpaces = savedData.map((data) => {
    const tabSpace = TabSpace.fromSavedDataWithoutTabs(data);
    data.tabIds.forEach((tabId) => {
      const savedTab = savedTabs.find((savedTab) => savedTab.id === tabId);
      const tab = Tab.fromSavedData(savedTab);
      tabSpace.addTab(tab);
    });
    return tabSpace;
  });

  perfEnd('query tabids for tabspaces');

  return savedTabSpaces;
}

export async function querySavedTabSpaceById(
  tabSpaceId: string,
): Promise<TabSpace> {
  const savedTabSpaces = await querySavedTabSpace({ anyOf: [tabSpaceId] });
  if (savedTabSpaces.length !== 1) {
    throw new Error(
      `queried saved tabspace id ${tabSpaceId} returns ${savedTabSpaces.length} results!`,
    );
  }
  return savedTabSpaces[0];
}

export async function saveTabSpace(tabSpace: TabSpace): Promise<number> {
  const {
    tabSpaceSavePayload,
    isNewTabSpace,
    newTabSavePayloads,
    existTabSavePayloads,
  } = tabSpace.convertAndGetSavePayload();
  await db.transaction(
    'rw',
    [db.table(Tab.DB_TABLE_NAME), db.table(TabSpace.DB_TABLE_NAME)],
    async (tx) => {
      if (isNewTabSpace) {
        await db.table(TabSpace.DB_TABLE_NAME).add(tabSpaceSavePayload);
      } else {
        await db.table(TabSpace.DB_TABLE_NAME).put(tabSpaceSavePayload);
      }
      await db.table(Tab.DB_TABLE_NAME).bulkAdd(newTabSavePayloads);
      await db.table(Tab.DB_TABLE_NAME).bulkPut(existTabSavePayloads);
    },
  );
  addTabSpaceToIndex(tabSpaceSavePayload.id);
  return Date.now();
}

export async function deleteSavedTabSpace(
  savedTabSpaceId: string,
): Promise<void> {
  const savedTabSpace = await db
    .table<ISavedTabSpace>(TabSpace.DB_TABLE_NAME)
    .get(savedTabSpaceId);
  await db.transaction(
    'rw',
    [db.table(Tab.DB_TABLE_NAME), db.table(TabSpace.DB_TABLE_NAME)],
    async (tx) => {
      await db.table(Tab.DB_TABLE_NAME).bulkDelete(savedTabSpace.tabIds);
      await db.table(TabSpace.DB_TABLE_NAME).delete(savedTabSpace.id);
    },
  );
  removeTabSpaceFromIndex(savedTabSpaceId);
}

const saveCurrentTabSpaceImpl = async () => {
  const { savedTabSpaceStore } = getTabSpaceData();
  const oldId = getTabSpaceData().tabSpace.id;

  savedTabSpaceStore.markInSaving(true);
  const savedTime = await saveTabSpace(getTabSpaceData().tabSpace);
  savedTabSpaceStore.markInSaving(false, savedTime);

  const newId = getTabSpaceData().tabSpace.id;
  if (oldId !== newId) {
    tabSpaceRegistryUpdateTabSpace({
      from: oldId,
      to: newId,
      entry: getTabSpaceData().tabSpace.toTabSpaceStub(),
    });
    sendPubSubMessage(TabSpaceMsg.ChangeID, { from: oldId, to: newId });
  }
};

export const saveCurrentTabSpace: () => void | Promise<void> = debounce(
  saveCurrentTabSpaceImpl,
  DEFAULT_SAVE_DEBOUNCE,
);
