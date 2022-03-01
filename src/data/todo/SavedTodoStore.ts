import {
  AllTodo,
  IAllTodoSavePayload,
  ITodoJSON,
  ITodoLocalStorage,
  Todo,
} from './Todo';
import {
  DEFAULT_SAVE_DEBOUNCE,
  InSavingStatus,
  SavedStore,
} from '../../store/store';
import {
  TabSpaceDBMsg,
  TabSpaceMsg,
  subscribePubSubMessage,
} from '../../message/message';
import { debounce, logger } from '../../global';

import { IDatabaseChange } from 'dexie-observable/api';
import { db } from '../../store/db';
import { getAllTodoData } from './bootstrap';
import { getTabSpaceData } from '../tabSpace/bootstrap';
import { observe } from 'mobx';
import {
  getLocalStorageKey,
  localStorageAddListener,
  localStorageGetItem,
  localStoragePutItem,
  localStorageRemoveListener,
} from '../../store/localStorageWrapper';

export const LOCALSTORAGE_TODO_KEY = getLocalStorageKey('todo');

export class SavedTodoStore extends SavedStore {}

export function monitorDbChanges(savedStore: SavedTodoStore) {
  subscribePubSubMessage(
    TabSpaceDBMsg.Changed,
    (message, data: IDatabaseChange[]) => {
      logger.log('pubsub:', message, data);
      data.forEach((d) => {
        if (d.table === Todo.DB_TABLE_NAME) {
          savedStore.increaseSavedDataVersion();
        }
      });
    },
  );
}

export function monitorTabSpaceChanges(allTodo: AllTodo) {
  subscribePubSubMessage(TabSpaceMsg.ChangeID, (message, data) => {
    logger.log('pubsub:', message, data);
    const { to } = data;
    allTodo.updateTabSpaceId(to);
  });
}

export function startMonitorLocalStorageChanges(allNote: AllTodo) {
  localStorageAddListener(LOCALSTORAGE_TODO_KEY, (key, newValue, oldValue) => {
    const todoJSONs = JSON.parse(newValue) as ITodoLocalStorage[];
    allNote.restoreFromLocalStorageJSON(todoJSONs);
  });
  // immediately load once after the monitoring is started
  localStorageGetItem(LOCALSTORAGE_TODO_KEY, (value: string) => {
    const todoJSONs = JSON.parse(value) as ITodoLocalStorage[];
    allNote.restoreFromLocalStorageJSON(todoJSONs);
  });
}

export function stopMonitorLocalStorageChanges() {
  localStorageRemoveListener(LOCALSTORAGE_TODO_KEY);
}

export function monitorAllTodoChange(
  allTodo: AllTodo,
  savedTodoStore: SavedTodoStore,
) {
  observe(allTodo, (change) => {
    logger.log('allTodo changed:', change);
    if (savedTodoStore.inSaving === InSavingStatus.InSaving) {
      logger.log('todo inSaving, skip');
    } else {
      if (getTabSpaceData().tabSpace.needAutoSave()) {
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

export async function queryAllTodo(
  tabSpaceId: string,
  params?: any,
): Promise<AllTodo> {
  const allTodosData: IAllTodoSavePayload[] = await db
    .table(AllTodo.DB_TABLE_NAME)
    .where('tabSpaceId')
    .equals(tabSpaceId)
    .toArray();
  if (allTodosData.length <= 0) {
    return new AllTodo(tabSpaceId);
  } else {
    const allTodo = AllTodo.fromSavedData(allTodosData[0]);
    const todosData: ITodoJSON[] = await db
      .table(Todo.DB_TABLE_NAME)
      .bulkGet(allTodosData[0].todoIds);
    todosData.forEach((todoData) => allTodo.addTodo(Todo.fromJSON(todoData)));
    return allTodo;
  }
}

async function saveAllTodo(allTodo: AllTodo): Promise<number> {
  // super stupid saving strategy: save them all when needed
  await db.transaction(
    'rw',
    [db.table(Todo.DB_TABLE_NAME), db.table(AllTodo.DB_TABLE_NAME)],
    async (tx) => {
      const {
        allTodoSavePayload,
        isNewAllTodo,
        newTodoSavePayloads,
        existTodoSavePayloads,
      } = allTodo.convertAndGetSavePayload();
      await db.table(Todo.DB_TABLE_NAME).bulkAdd(newTodoSavePayloads);
      await db.table(Todo.DB_TABLE_NAME).bulkPut(existTodoSavePayloads);
      if (isNewAllTodo) {
        await db.table(AllTodo.DB_TABLE_NAME).add(allTodoSavePayload);
      } else {
        await db.table(AllTodo.DB_TABLE_NAME).put(allTodoSavePayload);
      }
    },
  );
  return Date.now();
}

const saveCurrentAllTodoImpl = async () => {
  const { allTodo, savedTodoStore } = getAllTodoData();
  savedTodoStore.markInSaving(true);
  const savedTime = await saveAllTodo(allTodo);
  savedTodoStore.markInSaving(false, savedTime);
};

export const saveCurrentAllTodo: () => void | Promise<void> = debounce(
  saveCurrentAllTodoImpl,
  DEFAULT_SAVE_DEBOUNCE,
);

export const saveCurrentAllTodoToLocalStorage = () => {
  const { allTodo } = getAllTodoData();
  localStoragePutItem(
    LOCALSTORAGE_TODO_KEY,
    JSON.stringify(allTodo.getLocalStorageJSON()),
  );
};
