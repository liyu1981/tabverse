import {
  addTodo,
  AllTodo,
  AllTodoSavePayload,
  ALLTODO_DB_TABLE_NAME,
  convertAndGetAllTodoSavePayload,
  getLocalStorageJSON,
  newEmptyAllTodo,
  updateTabSpaceId,
} from './AllTodo';
import { $allTodo, $todoStorageStore, todoStoreApi } from './store';
import { TabSpaceMsg, subscribePubSubMessage } from '../../message/message';
import { debounce, logger } from '../../global';
import {
  getLocalStorageKey,
  localStorageAddListener,
  localStorageGetItem,
  localStoragePutItem,
  localStorageRemoveListener,
} from '../../store/localStorageWrapper';

import { Todo, TodoLocalStorage, TODO_DB_TABLE_NAME } from './Todo';
import { db } from '../../store/db';
import { isIdNotSaved } from '../common';
import { isJestTest } from '../../debug';
import { updateFromSaved } from '../Base';
import { isArray } from 'lodash';
import { needAutoSave } from '../tabSpace/TabSpace';
import { $tabSpace } from '../tabSpace/store';
import {
  addPagingToQueryParams,
  DEFAULT_SAVE_DEBOUNCE,
  InSavingStatus,
} from '../../store/storage';

export const LOCALSTORAGE_TODO_KEY = getLocalStorageKey('todo');

export function monitorTabSpaceChanges() {
  subscribePubSubMessage(TabSpaceMsg.ChangeID, (message, data) => {
    logger.log('pubsub:', message, data);
    const { to } = data;
    todoStoreApi.updateTabSpaceId(to);
  });
}

export async function loadCurrentAllTodoFromLocalStorage() {
  return new Promise<void>((resolve, reject) => {
    localStorageGetItem(LOCALSTORAGE_TODO_KEY, (value: string) => {
      const todoJSONs = JSON.parse(value) as TodoLocalStorage[];
      if (isArray(todoJSONs)) {
        todoStoreApi.restoreFromLocalStorageJSON(todoJSONs);
      }
      resolve();
    });
  });
}

export async function loadAllTodoByTabSpaceId(tabSpaceId: string) {
  if (isIdNotSaved(tabSpaceId) && !isJestTest()) {
    await loadCurrentAllTodoFromLocalStorage();
  } else {
    const savedAllTodo = await queryAllTodo(
      tabSpaceId,
      addPagingToQueryParams({}),
    );
    todoStoreApi.update(savedAllTodo);
    todoStoreApi.updateLastSavedTime(savedAllTodo.updatedAt);
  }
}

export function startMonitorLocalStorageChanges() {
  localStorageAddListener(LOCALSTORAGE_TODO_KEY, (key, newValue, oldValue) => {
    const todoJSONs = JSON.parse(newValue) as TodoLocalStorage[];
    todoStoreApi.restoreFromLocalStorageJSON(todoJSONs);
  });
  // immediately load once after the monitoring is started
  loadCurrentAllTodoFromLocalStorage();
}

export function stopMonitorLocalStorageChanges() {
  localStorageRemoveListener(LOCALSTORAGE_TODO_KEY);
}

export function monitorAllTodoChanges() {
  $allTodo.watch((currentAllTodo) => {
    logger.log('allTodo changed:', currentAllTodo);
    if ($todoStorageStore.getState().inSaving === InSavingStatus.InSaving) {
      logger.log('todo inSaving, skip');
    } else {
      if (needAutoSave($tabSpace.getState())) {
        logger.log(
          'current tabSpace need autoSave, will then saveCurrentAllTodo',
        );
        saveCurrentAllTodo();
      } else {
        logger.log(
          'current tabSpace is not on autoSave, will then save todos to localStorage',
        );
        saveCurrentAllTodoToLocalStorage();
      }
    }
  });
}

async function saveAllTodo(): Promise<number> {
  // super stupid saving strategy: save them all when needed
  const updatedAt = await db.transaction(
    'rw',
    [db.table(TODO_DB_TABLE_NAME), db.table(ALLTODO_DB_TABLE_NAME)],
    async (tx) => {
      const {
        allTodo,
        allTodoSavePayload,
        isNewAllTodo,
        newTodoSavePayloads,
        existTodoSavePayloads,
      } = convertAndGetAllTodoSavePayload($allTodo.getState());
      await db.table(TODO_DB_TABLE_NAME).bulkAdd(newTodoSavePayloads);
      await db.table(TODO_DB_TABLE_NAME).bulkPut(existTodoSavePayloads);
      if (isNewAllTodo) {
        await db.table(ALLTODO_DB_TABLE_NAME).add(allTodoSavePayload);
      } else {
        await db.table(ALLTODO_DB_TABLE_NAME).put(allTodoSavePayload);
      }
      todoStoreApi.update(allTodo);
      return allTodoSavePayload.updatedAt;
    },
  );
  return updatedAt;
}

const saveCurrentAllTodoImpl = async () => {
  todoStoreApi.markInSaving(true);
  const savedTime = await saveAllTodo();
  todoStoreApi.updateLastSavedTime(savedTime);
  todoStoreApi.markInSaving(false);
};

export const saveCurrentAllTodo = debounce(
  saveCurrentAllTodoImpl,
  DEFAULT_SAVE_DEBOUNCE,
);

export function saveCurrentAllTodoToLocalStorage() {
  localStoragePutItem(
    LOCALSTORAGE_TODO_KEY,
    JSON.stringify(getLocalStorageJSON($allTodo.getState())),
  );
}

export async function queryAllTodo(
  tabSpaceId: string,
  params?: any,
): Promise<AllTodo> {
  const allTodosData = await db
    .table<AllTodoSavePayload>(ALLTODO_DB_TABLE_NAME)
    .where('tabSpaceId')
    .equals(tabSpaceId)
    .toArray();
  if (allTodosData.length <= 0) {
    return updateTabSpaceId(tabSpaceId, newEmptyAllTodo());
  } else {
    const savedAllTodo = allTodosData[0];
    let allTodo = updateTabSpaceId(
      savedAllTodo.tabSpaceId,
      updateFromSaved(savedAllTodo, newEmptyAllTodo()),
    );
    const todosData = await db
      .table<Todo>(TODO_DB_TABLE_NAME)
      .bulkGet(allTodosData[0].todoIds);
    todosData.forEach((todoData) => {
      allTodo = addTodo(todoData, allTodo);
    });
    return allTodo;
  }
}
