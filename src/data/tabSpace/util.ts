import { $tabSpace, $tabSpaceStorage, tabSpaceStoreApi } from './store';
import { QUERY_PAGE_LIMIT_DEFAULT, db } from '../../storage/db';
import {
  TABSPACE_DB_TABLE_NAME,
  TabSpace,
  TabSpaceSavePayload,
  addTabs,
  cloneTabSpace,
  convertAndGetTabSpaceSavePayload,
  fromSavedDataWithoutTabs,
  insertTab,
  needAutoSave,
  toTabSpaceStub,
  updateTab,
  updateTabSpace,
} from './TabSpace';
import { TAB_DB_TABLE_NAME, Tab, TabSavePayload, fromSavedTab } from './Tab';
import {
  TabSpaceDBMsg,
  TabSpaceMsg,
  sendPubSubMessage,
  subscribePubSubMessage,
} from '../../message/message';
import {
  debounce,
  hasOwnProperty,
  logger,
  perfEnd,
  perfStart,
} from '../../global';

import { DEFAULT_SAVE_DEBOUNCE } from '../../storage/StorageOverview';
import { IDatabaseChange } from 'dexie-observable/api';
import { InSavingStatus } from '../../storage/GeneralStorage';
import { addTabSpaceToIndex } from '../../background/fullTextSearch/addToIndex';
import { filter } from 'lodash';
import { removeTabSpaceFromIndex } from '../../background/fullTextSearch/api';
import { updateTabSpace as tabSpaceRegistryUpdateTabSpace } from '../tabSpaceRegistry';

export function monitorDbChanges() {
  const querySavedTabSpaceCount = () => {
    return db.table(TABSPACE_DB_TABLE_NAME).count();
  };

  subscribePubSubMessage(
    TabSpaceDBMsg.Changed,
    (message, data: IDatabaseChange[]) => {
      logger.log('pubsub:', message, data);
      data.forEach((d) => {
        if (
          d.table === TABSPACE_DB_TABLE_NAME ||
          d.table === TAB_DB_TABLE_NAME
        ) {
          tabSpaceStoreApi.increaseSavedDataVersion();
          querySavedTabSpaceCount().then((savedTabSpaceCount) =>
            tabSpaceStoreApi.updateTotalSavedCount(savedTabSpaceCount),
          );
        }
      });
    },
  );
}

export function monitorTabSpaceChanges() {
  const watcher = $tabSpace.watch((updatedTabSpace) => {
    logger.log('tabSpace changed:', updatedTabSpace);
    if ($tabSpaceStorage.getState().inSaving === InSavingStatus.InSaving) {
      logger.log('in saving, skip');
    } else {
      if (needAutoSave(updatedTabSpace)) {
        logger.log(
          'current tabSpace need autoSave, will then saveCurrentTabSpace',
        );
        saveCurrentTabSpace();
      }
    }
  });
  return watcher;
}

export interface QuerySavedTabSpaceParams {
  anyOf?: string[];
  noneOf?: string[];
  pageStart?: number;
  pageLimit?: number;
}

export async function querySavedTabSpace(
  params?: QuerySavedTabSpaceParams,
): Promise<TabSpace[]> {
  perfStart('query table space');
  let savedData: TabSpaceSavePayload[] = [];
  const pageStart = params?.pageStart ?? 0;
  const pageLimit = params?.pageLimit ?? QUERY_PAGE_LIMIT_DEFAULT;

  if (hasOwnProperty(params, 'anyOf')) {
    savedData = await db
      .table<TabSpaceSavePayload>(TABSPACE_DB_TABLE_NAME)
      .bulkGet(params.anyOf);
    savedData.sort((d1, d2) => d2.createdAt - d1.createdAt);
    savedData = savedData.slice(
      pageStart * pageLimit,
      (pageStart + 1) * pageLimit,
    );
  } else if (hasOwnProperty(params, 'noneOf')) {
    savedData = (
      await db
        .table<TabSpaceSavePayload>(TABSPACE_DB_TABLE_NAME)
        .where('id')
        .noneOf(params.noneOf)
        .sortBy('createdAt')
    ).reverse();
  } else {
    const savedDataQuery = db
      .table<TabSpaceSavePayload>(TABSPACE_DB_TABLE_NAME)
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

  perfStart('query tabIds for tabSpaces');
  // performance optimization to bulk load all tabs of tabSpaces then distribute
  const toLoadTabIds = savedData.reduce<string[]>((s, data) => {
    return s.concat(data.tabIds);
  }, []);
  const savedTabs = await db
    .table<TabSavePayload>(TAB_DB_TABLE_NAME)
    .bulkGet(toLoadTabIds);
  const savedTabSpaces = savedData.map((data) => {
    let tabSpace = fromSavedDataWithoutTabs(data);
    data.tabIds.forEach((tabId) => {
      const savedTab = savedTabs.find((savedTab) => savedTab.id === tabId);
      const tab = fromSavedTab(savedTab);
      tabSpace = insertTab({ tab }, tabSpace);
    });
    return tabSpace;
  });
  perfEnd('query tabIds for tabSpaces');

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

export async function saveTabSpace(targetTabSpace: TabSpace): Promise<number> {
  const {
    tabSpace: updatedTabSpace,
    tabSpaceSavePayload,
    isNewTabSpace,
    newTabSavePayloads,
    existTabSavePayloads,
  } = convertAndGetTabSpaceSavePayload(targetTabSpace);
  // console.log('tabSpaceSavePayload is:', tabSpaceSavePayload);
  const updatedAt = await db.transaction(
    'rw',
    [db.table(TAB_DB_TABLE_NAME), db.table(TABSPACE_DB_TABLE_NAME)],
    async (tx) => {
      if (isNewTabSpace) {
        await db.table(TABSPACE_DB_TABLE_NAME).add(tabSpaceSavePayload);
      } else {
        await db.table(TABSPACE_DB_TABLE_NAME).put(tabSpaceSavePayload);
      }
      await db.table(TAB_DB_TABLE_NAME).bulkAdd(newTabSavePayloads);
      await db.table(TAB_DB_TABLE_NAME).bulkPut(existTabSavePayloads);
      return tabSpaceSavePayload.updatedAt;
    },
  );
  tabSpaceStoreApi.update(updatedTabSpace);
  addTabSpaceToIndex(tabSpaceSavePayload.id);
  return updatedAt;
}

export async function deleteSavedTabSpace(
  savedTabSpaceId: string,
): Promise<void> {
  await db.transaction(
    'rw',
    [db.table(TAB_DB_TABLE_NAME), db.table(TABSPACE_DB_TABLE_NAME)],
    async (tx) => {
      const savedTabSpace = await db
        .table<TabSpaceSavePayload>(TABSPACE_DB_TABLE_NAME)
        .get(savedTabSpaceId);
      await db.table(TAB_DB_TABLE_NAME).bulkDelete(savedTabSpace.tabIds);
      await db.table(TABSPACE_DB_TABLE_NAME).delete(savedTabSpace.id);
    },
  );
  removeTabSpaceFromIndex(savedTabSpaceId);
}

const saveCurrentTabSpaceImpl = async () => {
  const oldId = $tabSpace.getState().id;

  tabSpaceStoreApi.markInSaving(true);
  const savedTime = await saveTabSpace($tabSpace.getState());
  tabSpaceStoreApi.updateLastSavedTime(savedTime);
  tabSpaceStoreApi.markInSaving(false);

  const newId = $tabSpace.getState().id;
  if (oldId !== newId) {
    tabSpaceRegistryUpdateTabSpace({
      from: oldId,
      to: newId,
      entry: toTabSpaceStub($tabSpace.getState()),
    });
    sendPubSubMessage(TabSpaceMsg.ChangeID, { from: oldId, to: newId });
  }
};

export const saveCurrentTabSpace: () => void | Promise<void> = debounce(
  saveCurrentTabSpaceImpl,
  DEFAULT_SAVE_DEBOUNCE,
);

export async function moveTabsToTabSpace(
  toMoveTabs: Tab[],
  targetTabSpace: TabSpace,
) {
  let newTabSpace = cloneTabSpace(targetTabSpace);
  newTabSpace = addTabs(toMoveTabs, newTabSpace);
  await saveTabSpace(newTabSpace);
}

export async function loadTabSpaceByTabSpaceId(
  savedTabSpaceId: string,
  chromeTabId: number,
  chromeWindowId: number,
) {
  let tabSpace = await querySavedTabSpaceById(savedTabSpaceId);
  tabSpace = updateTabSpace({ chromeTabId, chromeWindowId }, tabSpace);

  // remove any other tabs before loading our tabs
  await Promise.all(
    filter(
      await chrome.tabs.query({ currentWindow: true }),
      (tab) => tab.id !== chromeTabId,
    ).map((otherTab) => chrome.tabs.remove(otherTab.id)),
  );

  // here we do not use map but use for loop to ensure that we restore tabs in
  // the saved order
  for (let i = 0; i < tabSpace.tabs.size; i++) {
    const savedTab = tabSpace.tabs.get(i);
    const chromeTab = await chrome.tabs.create({ url: savedTab.url });
  }

  tabSpaceStoreApi.update(tabSpace);

  // focus tabspace tab
  const currentTab = await chrome.tabs.getCurrent();
  await chrome.tabs.update(currentTab.id, { active: true });
}

export async function querySavedTabSpaceCount() {
  return await db.table(TABSPACE_DB_TABLE_NAME).count();
}
