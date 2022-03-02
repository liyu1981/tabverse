import { AllTodo, Todo } from './Todo';
import {
  SavedTodoStore,
  loadCurrentAllTodoFromLocalStorage,
  monitorAllTodoChange,
  monitorTabSpaceChanges,
  queryAllTodo,
} from './SavedTodoStore';
import { exposeDebugData, isJestTest } from '../../debug';

import { NotTabSpaceId } from '../chromeSession/ChromeSession';
import { addPagingToQueryParams } from '../../store/store';
import { strict as assert } from 'assert';
import { getSavedStoreManager } from '../../store/bootstrap';
import { isIdNotSaved } from '../common';

export interface AllTodoData {
  allTodo: AllTodo;
  savedTodoStore: SavedTodoStore;
}

let allTodoData: AllTodoData | null = null;

export function getAllTodoData(): AllTodoData {
  assert(allTodoData !== null, 'call bootstrap to init allTodoData!');
  return allTodoData;
}

export function bootstrap() {
  allTodoData = {
    allTodo: new AllTodo(NotTabSpaceId),
    savedTodoStore: new SavedTodoStore(),
  };

  getSavedStoreManager().addSavedStore('todo', allTodoData.savedTodoStore);

  exposeDebugData('todo', { getAllTodoData });
}

export async function loadByTabSpaceId(tabSpaceId: string) {
  const { allTodo, savedTodoStore } = getAllTodoData();
  if (isIdNotSaved(tabSpaceId) && !isJestTest()) {
    await loadCurrentAllTodoFromLocalStorage(allTodo);
  } else {
    const loadedAllTodo = await queryAllTodo(
      tabSpaceId,
      addPagingToQueryParams({}),
    );
    allTodo.copy(loadedAllTodo);
  }

  const latestSavedTime =
    allTodo.todos.max((ta: Todo, tb: Todo) =>
      ta.updatedAt > tb.updatedAt ? 1 : ta.updatedAt === tb.updatedAt ? 0 : -1,
    )?.updatedAt ?? 0;
  savedTodoStore.updateLastSavedTime(latestSavedTime);

  monitorTabSpaceChanges(allTodo);
  monitorAllTodoChange(allTodo, savedTodoStore);
}
