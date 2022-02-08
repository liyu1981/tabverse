import {
  DEFAULT_SAVE_DEBOUNCE,
  InSavingStatus,
  SavedStore,
  queryPageLimit,
} from '../../store/store';
import { ISavedTab, Tab } from './Tab';
import { ISavedTabSpace, TabSpace } from './TabSpace';
import { ITabSpaceData, getTabSpaceData } from './bootstrap';
import {
  TabSpaceDBMsg,
  TabSpaceMsg,
  TabSpaceRegistryMsg,
  sendChromeMessage,
  sendPubSubMessage,
  subscribePubSubMessage,
} from '../../message';
import { debounce, logger } from '../../global';

import { IDatabaseChange } from 'dexie-observable/api';
import { strict as assert } from 'assert';
import { db } from '../../store/db';
import { map } from 'lodash';
import { observe } from 'mobx';

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

async function querySavedTabsForTabSpace(
  savedData: ISavedTabSpace,
): Promise<TabSpace> {
  const tabSpace = TabSpace.fromSavedDataWithoutTabs(savedData);
  const savedTabs = await db
    .table<ISavedTab>(Tab.DB_TABLE_NAME)
    .where('id')
    .anyOf(savedData.tabIds)
    .toArray();
  savedData.tabIds.forEach((tabId) => {
    const savedTab = savedTabs.find((savedTab) => savedTab.id === tabId);
    const tab = Tab.fromSavedData(savedTab);
    tabSpace.addTab(tab);
  });
  return tabSpace;
}

export async function querySavedTabSpace(
  params?: IQuerySavedTabSpaceParams,
): Promise<TabSpace[]> {
  let saveDataQuery = db
    .table<ISavedTabSpace>(TabSpace.DB_TABLE_NAME)
    .orderBy('createdAt')
    .reverse();

  if (params && 'anyOf' in params) {
    saveDataQuery = saveDataQuery.filter((entry) => {
      return params.anyOf.findIndex((i) => i === entry.id) >= 0;
    });
  }

  if (params && 'noneOf' in params) {
    saveDataQuery = saveDataQuery.filter((entry) => {
      return params.noneOf.findIndex((i) => i === entry.id) < 0;
    });
  }

  if (params && 'pageStart' in params && 'pageLimit' in params) {
    saveDataQuery = saveDataQuery
      .offset(params?.pageStart * params.pageLimit ?? 0)
      .limit(params?.pageLimit ?? queryPageLimit);
  }

  const saveData = await saveDataQuery.toArray();
  const sts = await Promise.all(
    map(saveData, async (data) => {
      return await querySavedTabsForTabSpace(data);
    }),
  );
  return sts;
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
  console.log(
    'will save tabspace:',
    tabSpaceSavePayload,
    newTabSavePayloads,
    existTabSavePayloads,
  );
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
  return Date.now();
}

export async function deleteSavedTabSpace(
  savedTabSpaceId: string,
): Promise<void> {
  const savedTabSpaces = await db
    .table<ISavedTabSpace>(TabSpace.DB_TABLE_NAME)
    .where('id')
    .equals(savedTabSpaceId)
    .toArray();
  assert(
    savedTabSpaces.length === 1,
    `More than one saved tabspace found with id ${savedTabSpaceId}`,
  );
  const savedTabSpace = savedTabSpaces[0];
  await db.transaction(
    'rw',
    [db.table(Tab.DB_TABLE_NAME), db.table(TabSpace.DB_TABLE_NAME)],
    async (tx) => {
      await db.table(Tab.DB_TABLE_NAME).bulkDelete(savedTabSpace.tabIds);
      await db.table(TabSpace.DB_TABLE_NAME).delete(savedTabSpace.id);
    },
  );
}

const saveCurrentTabSpaceImpl = async () => {
  const { savedTabSpaceStore } = getTabSpaceData();
  const oldId = getTabSpaceData().tabSpace.id;
  savedTabSpaceStore.markInSaving(true);
  const savedTime = await saveTabSpace(getTabSpaceData().tabSpace);
  savedTabSpaceStore.markInSaving(false, savedTime);
  const newId = getTabSpaceData().tabSpace.id;
  if (oldId !== newId) {
    const changed = getTabSpaceData().tabSpaceRegistry.mergeRegistryChanges([
      {
        from: oldId,
        to: newId,
        entry: getTabSpaceData().tabSpace.toTabSpaceStub(),
      },
    ]);
    if (changed) {
      sendChromeMessage({
        type: TabSpaceRegistryMsg.UpdateRegistry,
        payload: {
          from: oldId,
          to: newId,
          entry: getTabSpaceData().tabSpace.toTabSpaceStub(),
        },
      });
    }
    sendPubSubMessage(TabSpaceMsg.ChangeID, { from: oldId, to: newId });
  }
};

export const saveCurrentTabSpace: () => void | Promise<void> = debounce(
  saveCurrentTabSpaceImpl,
  DEFAULT_SAVE_DEBOUNCE,
);
