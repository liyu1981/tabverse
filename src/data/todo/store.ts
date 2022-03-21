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
import {
  GeneralStorage,
  increaseSavedDataVersion,
  markInSaving,
  newEmptyGeneralStorage,
  updateLastSavedTime,
} from '../storage/Storage';
import { createApi, createStore } from 'effector';

import { Todo, TodoLocalStorage } from './Todo';
import { merge } from 'lodash';

export const $allTodo = createStore<AllTodo>(newEmptyAllTodo());
export type AllTodoStore = typeof $allTodo;

export const $todoStorage = createStore<GeneralStorage>(
  newEmptyGeneralStorage(),
);
export type TodoStorageStore = typeof $todoStorage;

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

const todoStorageApi = createApi($todoStorage, {
  increaseSavedDataVersion: (lastStorage) =>
    increaseSavedDataVersion(lastStorage),
  markInSaving: (lastStorage, inSaving: boolean) =>
    markInSaving(inSaving, lastStorage),
  updateLastSavedTime: (lastStorage, lastSavedTime: number) =>
    updateLastSavedTime(lastSavedTime, lastStorage),
});

export const todoStoreApi = merge(allTodoApi, todoStorageApi);
export type TodoStoreApi = typeof todoStoreApi;
