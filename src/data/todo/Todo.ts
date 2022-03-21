import { NotId, convertToSavedBase, newEmptyBase } from '../Base';

import { IBase } from '../common';

export interface Todo extends IBase {
  tabSpaceId: string;
  content: string;
  completed: boolean;
}

export type TodoLocalStorage = Pick<Todo, 'content' | 'completed'>;

export const TODO_DB_TABLE_NAME = 'SavedTodo';
export const TODO_DB_SCHEMA = 'id, createdAt, tabSpaceId, content, completed';

export function newEmptyTodo(): Todo {
  return {
    ...newEmptyBase(),
    tabSpaceId: NotId,
    content: '',
    completed: false,
  };
}

export function cloneTodo(targetTodo: Todo): Todo {
  return { ...targetTodo };
}

export function setTabSpaceId(tabSpaceId: string, targetTodo): Todo {
  return { ...targetTodo, tabSpaceId };
}

export function setContent(content: string, targetTodo: Todo): Todo {
  return { ...targetTodo, content };
}

export function setCompleted(completed: boolean, targetTodo: Todo): Todo {
  return { ...targetTodo, completed };
}

export function convertToSavedTodo(targetTodo: Todo): Todo {
  return {
    ...targetTodo,
    ...convertToSavedBase(targetTodo),
  };
}
