import { AllTodo, Todo } from './todo';
import {
  SavedTodoStore,
  monitorAllTodoChange,
  monitorTabSpaceChanges,
  queryAllTodo,
} from './todoStore';

import { NotTabSpaceId } from '../chromeSession/session';
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
  const loadedAllTodo = await queryAllTodo(
    tabSpaceId,
    addPagingToQueryParams({}),
  );
  allTodo.copy(loadedAllTodo);

  const latestSavedTime =
    allTodo.todos.max((ta: Todo, tb: Todo) =>
      ta.updatedAt > tb.updatedAt ? 1 : ta.updatedAt === tb.updatedAt ? 0 : -1,
    )?.updatedAt ?? 0;
  savedTodoStore.updateLastSavedTime(latestSavedTime);

  monitorTabSpaceChanges(allTodo);
  monitorAllTodoChange(allTodo, savedTodoStore);
}
