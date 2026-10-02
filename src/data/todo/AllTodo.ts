import { IBase } from '../common';
import {
  NotId,
  convertToSavedBase,
  inPlaceCopyFromOtherBase,
  newEmptyBase,
} from '../Base';
import { convertToSavedTodo, newEmptyTodo, setTabSpaceId } from './Todo';

import { List } from 'immutable';
import { Todo } from './Todo';
import { produce } from 'immer';

export interface AllTodo extends IBase {
  tabSpaceId: string;
  todos: List<Todo>;
}

export interface AllTodoSavePayload extends IBase {
  tabSpaceId: string;
  todoIds: string[];
}

export const ALLTODO_DB_TABLE_NAME = 'SavedAllTodo';
export const ALLTODO_DB_SCHEMA = 'id, createdAt, tabSpaceId, *todoIds';

export function newEmptyAllTodo(): AllTodo {
  return {
    ...newEmptyBase(),
    tabSpaceId: NotId,
    todos: List(),
  };
}

export function addTodo(todo: Todo, targetAllTodo: AllTodo): AllTodo {
  return produce(targetAllTodo, (draft) => {
    draft.todos = draft.todos.push(
      setTabSpaceId(targetAllTodo.tabSpaceId, todo),
    );
  });
}

export function updateTodo(
  tid: string,
  changes: Partial<Todo>,
  targetAllTodo: AllTodo,
): AllTodo {
  return produce(targetAllTodo, (draft) => {
    const tIndex = draft.todos.findIndex((todo) => todo.id === tid);
    if (tIndex >= 0) {
      const existTodo = draft.todos.get(tIndex);
      const newTodo = { ...existTodo, ...changes };
      draft.todos = draft.todos.set(tIndex, newTodo);
    }
  });
}

export function toggle(
  tid: string,
  completed: boolean,
  targetAllTodo: AllTodo,
): AllTodo {
  return updateTodo(tid, { completed }, targetAllTodo);
}

export function removeTodo(tid: string, targetAllTodo: AllTodo): AllTodo {
  return produce(targetAllTodo, (draft) => {
    const tIndex = draft.todos.findIndex((todo) => todo.id === tid);
    if (tIndex >= 0) {
      draft.todos = draft.todos.remove(tIndex);
    }
  });
}

export function clearCompleted(targetAllTodo: AllTodo): AllTodo {
  return produce(targetAllTodo, (draft) => {
    draft.todos = draft.todos.filter((todo) => !todo.completed).toList();
  });
}

export function updateTabSpaceId(
  newTabSpaceId: string,
  targetAllTodo: AllTodo,
): AllTodo {
  return produce(targetAllTodo, (draft) => {
    draft.tabSpaceId = newTabSpaceId;
    draft.todos = draft.todos
      .map((todo) => setTabSpaceId(newTabSpaceId, todo))
      .toList();
  });
}

export function convertAndGetAllTodoSavePayload(targetAllTodo: AllTodo): {
  allTodo: AllTodo;
  allTodoSavePayload: AllTodoSavePayload;
  todoSavePayloads: Todo[];
} {
  const savedTodos = targetAllTodo.todos.map(convertToSavedTodo).toList();
  const savedBase = convertToSavedBase(targetAllTodo);
  const savedAllTodo = produce(targetAllTodo, (draft) => {
    inPlaceCopyFromOtherBase(draft, savedBase);
    draft.todos = savedTodos;
  });
  const allTodoSavePayload = {
    ...savedBase,
    tabSpaceId: targetAllTodo.tabSpaceId,
    todoIds: savedTodos.map((todo) => todo.id).toArray(),
  };
  return {
    allTodo: savedAllTodo,
    allTodoSavePayload,
    todoSavePayloads: savedTodos.toArray(),
  };
}
