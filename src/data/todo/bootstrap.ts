import { AllTodo, Todo } from './todo';
import {
  SavedTodoStore,
  monitorAllTodoChange,
  monitorTabSpaceChanges,
  queryAllTodo,
} from './todoStore';

import { addPagingToQueryParams } from '../../store/store';
import { strict as assert } from 'assert';
import { exposeDebugData } from '../../debug';
import { getSavedStoreManager } from '../../store/bootstrap';

export interface AllTodoData {
  allTodo: AllTodo;
  savedTodoStore: SavedTodoStore;
}

let allTodoData: AllTodoData | null = null;

export function getAllTodoData(): AllTodoData {
  assert(allTodoData !== null, 'call bootstrap to init allTodoData!');
  return allTodoData;
}

export async function bootstrap(tabSpaceId: string) {
  const allTodo = await queryAllTodo(tabSpaceId, addPagingToQueryParams({}));
  const savedTodoStore = new SavedTodoStore();
  const latestSavedTime =
    allTodo.todos.max((ta: Todo, tb: Todo) =>
      ta.updatedAt > tb.updatedAt ? 1 : ta.updatedAt === tb.updatedAt ? 0 : -1,
    )?.updatedAt ?? 0;
  savedTodoStore.updateLastSavedTime(latestSavedTime);
  getSavedStoreManager().addSavedStore('todo', savedTodoStore);
  allTodoData = {
    allTodo,
    savedTodoStore,
  };

  monitorTabSpaceChanges(allTodo);
  monitorAllTodoChange(allTodo, savedTodoStore);
  exposeDebugData('todo', { getAllTodoData });
}
