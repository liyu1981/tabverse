import { IBase, isIdNotSaved } from '../common';
import {
  NotId,
  convertToSavedBase,
  inPlaceConvertToSaved,
  newEmptyBase,
} from '../Base';
import {
  TodoLocalStorage,
  convertToSavedTodo,
  newEmptyTodo,
  setTabSpaceId,
} from './Todo';

import { List } from 'immutable';
import { Todo } from './Todo';
import produce from 'immer';

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

export function cloneAllTodo(targetAllTodo: AllTodo): AllTodo {
  return produce(targetAllTodo, (draft) => {
    draft.todos = List(targetAllTodo.todos);
  });
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

export function getLocalStorageJSON(
  targetAllTodo: AllTodo,
): TodoLocalStorage[] {
  return targetAllTodo.todos
    .map((todo) => {
      return { content: todo.content, completed: todo.completed };
    })
    .toArray();
}

export function restoreFromLocalStorageJSON(
  todoJSONs: TodoLocalStorage[],
  targetAllTodo: AllTodo,
): AllTodo {
  return produce(targetAllTodo, (draft) => {
    draft.todos = List(
      todoJSONs.map((todoJSON) => ({
        ...newEmptyTodo(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tabSpaceId: targetAllTodo.tabSpaceId,
        content: todoJSON.content,
        completed: todoJSON.completed,
      })),
    );
  });
}

export function convertAndGetAllTodoSavePayload(targetAllTodo: AllTodo): {
  allTodo: AllTodo;
  allTodoSavePayload: AllTodoSavePayload;
  isNewAllTodo: boolean;
  newTodoSavePayloads: Todo[];
  existTodoSavePayloads: Todo[];
} {
  const isNewAllTodo = isIdNotSaved(targetAllTodo.id);
  const newTodoSavePayloads: Todo[] = [];
  const existTodoSavePayloads: Todo[] = [];
  const savedTodos = targetAllTodo.todos
    .map((todo) => {
      const isNewTodo = isIdNotSaved(todo.id);
      const savedTodo = convertToSavedTodo(todo);
      if (isNewTodo) {
        newTodoSavePayloads.push(savedTodo);
      } else {
        existTodoSavePayloads.push(savedTodo);
      }
      return savedTodo;
    })
    .toList();
  const savedAllTodo = produce(targetAllTodo, (draft) => {
    inPlaceConvertToSaved(draft);
    draft.todos = savedTodos;
  });
  const allTodoSavePayload = {
    ...convertToSavedBase(targetAllTodo),
    tabSpaceId: targetAllTodo.tabSpaceId,
    todoIds: savedTodos.map((todo) => todo.id).toArray(),
  };
  return {
    allTodo: savedAllTodo,
    allTodoSavePayload,
    isNewAllTodo,
    newTodoSavePayloads,
    existTodoSavePayloads,
  };
}
