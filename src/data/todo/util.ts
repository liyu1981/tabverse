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
import { addPagingToQueryParams, db } from '../../storage/db';
import { debounce } from '../../global';
import { DEFAULT_SAVE_DEBOUNCE } from '../../storage/StorageOverview';
import { updateFromSaved } from '../Base';

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
      const { allTodo, allTodoSavePayload, todoSavePayloads } =
        convertAndGetAllTodoSavePayload($allTodo.getState());
      await db.table(TODO_DB_TABLE_NAME).bulkPut(todoSavePayloads);
      await db.table(ALLTODO_DB_TABLE_NAME).put(allTodoSavePayload);
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

/**
 * Saves now, not after the debounce.
 *
 * Switching tools unmounts the tool, and the loader on the way back re-reads
 * the store from the database - so a change the debounce has not written yet is
 * gone when the person returns. Adding a todo, or clearing the completed ones,
 * must reach the database before that can happen.
 */
export const saveCurrentTodosNow = () => saveCurrentAllTodoImpl();

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
