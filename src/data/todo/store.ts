import {
  addTodo,
  AllTodo,
  clearCompleted,
  newEmptyAllTodo,
  removeTodo,
  restoreFromLocalStorageJSON,
  toggle,
  updateTabSpaceId,
  updateTodo,
} from './AllTodo';
import { createApi, createStore, forward } from 'effector';

import { Todo, TodoLocalStorage } from './Todo';
import { merge } from 'lodash';
import { exposeDebugData } from '../../debug';
import { createGeneralStorageStoreAndApi } from '../../storage/GeneralStorage';
import { storageOverviewApi } from '../../storage/StorageOverview';

export const $allTodo = createStore<AllTodo>(newEmptyAllTodo());
export type AllTodoStore = typeof $allTodo;

const allTodoApi = createApi($allTodo, {
  update: (lastAllTodo, updatedAllTodo: AllTodo) => updatedAllTodo,
  updateTabSpaceId: (lastAllTodo, newTabSpaceId: string) =>
    updateTabSpaceId(newTabSpaceId, lastAllTodo),
  restoreFromLocalStorageJSON: (lastAllTodo, todoJSONs: TodoLocalStorage[]) =>
    restoreFromLocalStorageJSON(todoJSONs, lastAllTodo),
  addTodo: (lastAllTodo, newTodo: Todo) => addTodo(newTodo, lastAllTodo),
  updateTodo: (
    lastAllTodo,
    { tid, changes }: { tid: string; changes: Partial<Todo> },
  ) => updateTodo(tid, changes, lastAllTodo),
  removeTodo: (lastAllTodo, tid: string) => removeTodo(tid, lastAllTodo),
  clearCompleted: (lastAllTodo) => clearCompleted(lastAllTodo),
  toggle: (
    lastAllTodo,
    { tid, completed }: { tid: string; completed: boolean },
  ) => toggle(tid, completed, lastAllTodo),
});

const { $store: $todoStorageStoreImpl, api: todoStorageApi } =
  createGeneralStorageStoreAndApi();
export const $todoStorage = $todoStorageStoreImpl;
export type TodoStorageStore = typeof $todoStorageStoreImpl;

forward({
  from: $todoStorage,
  to: storageOverviewApi.updateTodoStorage,
});

export const todoStoreApi = merge(allTodoApi, todoStorageApi);
export type TodoStoreApi = typeof todoStoreApi;

exposeDebugData('todo', {
  $allTodo,
  $todoStorage,
  todoStoreApi,
});
