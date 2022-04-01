import { IBase, setAttrForObject2 } from '../common';
import {
  NotId,
  convertToSavedBase,
  inPlaceConvertToSaved,
  newEmptyBase,
} from '../Base';

import { produce } from 'immer';

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
  return produce(targetTodo, (draft) => {});
}

export const setTabSpaceId = setAttrForObject2<string, Todo>('tabSpaceId');
export const setContent = setAttrForObject2<string, Todo>('content');
export const setCompleted = setAttrForObject2<boolean, Todo>('completed');

export function convertToSavedTodo(targetTodo: Todo): Todo {
  return produce(targetTodo, (draft) => {
    inPlaceConvertToSaved(draft);
  });
}
