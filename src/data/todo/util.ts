import { $allTodo, todoStoreApi } from './store';
import {
  ALLTODO_DB_TABLE_NAME,
  AllTodo,
  AllTodoSavePayload,
  addTodo,
  convertAndGetAllTodoSavePayload,
  newEmptyAllTodo,
  updateTabSpaceId,
} from './AllTodo';
import { TODO_DB_TABLE_NAME, Todo } from './Todo';
import { TabSpaceMsg, subscribePubSubMessage } from '../../message/message';
import { addPagingToQueryParams, db } from '../../storage/db';
import { debounce, logger } from '../../global';

import { $tabSpace } from '../tabSpace/store';
import { DEFAULT_SAVE_DEBOUNCE } from '../../storage/StorageOverview';
import { updateFromSaved } from '../Base';

export function monitorTabSpaceChanges() {
  subscribePubSubMessage(TabSpaceMsg.ChangeID, (message, data) => {
    logger.log('pubsub:', message, data);
    const { to } = data;
    todoStoreApi.updateTabSpaceId(to);
  });
}

export async function loadAllTodoByTabSpaceId(tabSpaceId: string) {
  const savedAllTodo = await queryAllTodo(
    tabSpaceId,
    addPagingToQueryParams({}),
  );
  todoStoreApi.update(savedAllTodo);
  todoStoreApi.updateLastSavedTime(savedAllTodo.updatedAt);
}

/**
 * Saves the store's todos now, skipping the debounce. Used by "save and
 * close" (see data/tabSpace/closeTabSpace.ts).
 */
export async function saveAllTodo(): Promise<number> {
  // super stupid saving strategy: save them all when needed
  const updatedAt = await db.transaction(
    'rw',
    [db.table(TODO_DB_TABLE_NAME), db.table(ALLTODO_DB_TABLE_NAME)],
    async (_tx) => {
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

export const saveCurrentTodos = () => {
  // a tabverse is born saved (its id is minted when the tab is opened), so
  // there is no "not saved yet" state to fall back to
  saveCurrentAllTodo();
};

export async function queryAllTodo(
  tabSpaceId: string,
  _params?: any,
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
