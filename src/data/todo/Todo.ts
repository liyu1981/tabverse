import { Base, IBase, isIdNotSaved } from '../common';
import { action, makeObservable, observable } from 'mobx';
import { extend, merge } from 'lodash';

import { List } from 'immutable';

export interface ITodo extends IBase {
  tabSpaceId: string;
  content: string;
  completed: boolean;
}

export type ITodoJSON = ITodo;
export type ITodoSavePayload = ITodoJSON;
export type ITodoLocalStorage = Pick<ITodoJSON, 'content' | 'completed'>;

export class Todo extends Base implements ITodo {
  tabSpaceId: string;
  content: string;
  completed: boolean;

  static DB_TABLE_NAME = 'SavedTodo';
  static DB_SCHEMA = 'id, createdAt, tabSpaceId, content, completed';

  constructor() {
    super();
    this.tabSpaceId = '';
    this.content = '';
    this.completed = false;
  }

  clone() {
    const t = new Todo();
    t.cloneAttributes(this);
    t.tabSpaceId = this.tabSpaceId;
    t.content = this.content;
    t.completed = this.completed;
    return t;
  }

  toJSON(): ITodoJSON {
    return extend(super.toJSON(), {
      tabSpaceId: this.tabSpaceId,
      content: this.content,
      completed: this.completed,
    });
  }

  static fromJSON(d: ITodoJSON): Todo {
    const t = new Todo();
    t.cloneAttributes(d);
    t.tabSpaceId = d.tabSpaceId;
    t.content = d.content;
    t.completed = d.completed;
    return t;
  }

  convertAndGetSavePayload(): ITodoSavePayload {
    this.convertToSaved();
    return this.toJSON();
  }
}

export interface IAllTodoSavePayload extends IBase {
  tabSpaceId: string;
  todoIds: string[];
}

export class AllTodo extends Base {
  tabSpaceId: string;
  todos: List<Todo>;

  static DB_TABLE_NAME = 'SavedAllTodo';
  static DB_SCHEMA = 'id, createdAt, tabSpaceId, *todoIds';

  constructor(tabSpaceId: string) {
    super();

    makeObservable(
      this,
      extend(Base.getMakeObservableDef(), {
        todos: observable,
        tabSpaceId: observable,

        restoreFromLocalStorageJSON: action,
        addTodo: action,
        updateTodo: action,
        toggle: action,
        clearCompleted: action,
        updateTabSpaceId: action,
        convertAndGetSavePayload: action,
      }),
    );

    this.tabSpaceId = tabSpaceId;
    this.todos = List();
  }

  clone(): AllTodo {
    const newAllTodo = new AllTodo(this.tabSpaceId);
    newAllTodo.cloneAttributes(this);
    newAllTodo.todos = List(this.todos);
    return newAllTodo;
  }

  copy(otherAllTodo: AllTodo) {
    this.cloneAttributes(otherAllTodo);
    this.todos = List(otherAllTodo.todos);
    this.tabSpaceId = otherAllTodo.tabSpaceId;
    return this;
  }

  getLocalStorageJSON(): ITodoLocalStorage[] {
    return this.todos
      .map((todo) => {
        return { content: todo.content, completed: todo.completed };
      })
      .toArray();
  }

  restoreFromLocalStorageJSON(todoJSONs: ITodoLocalStorage[]) {
    this.todos = List(
      todoJSONs.map((todoJSON) => {
        const t = new Todo();
        t.createdAt = Date.now();
        t.updatedAt = Date.now();
        t.tabSpaceId = this.tabSpaceId;
        t.content = todoJSON.content;
        t.completed = todoJSON.completed;
        return t;
      }),
    );
    return this;
  }

  addTodo(t: Todo) {
    t.tabSpaceId = this.tabSpaceId;
    this.todos = this.todos.push(t.clone().makeImmutable());
    return this;
  }

  updateTodo(tid: string, changes: Partial<Todo>) {
    const tIndex = this.todos.findIndex((todo) => todo.id === tid);
    if (tIndex >= 0) {
      const existTodo = this.todos.get(tIndex);
      const newTodo = existTodo.clone();
      merge(newTodo, changes);
      this.todos = this.todos.set(tIndex, newTodo.makeImmutable());
      return newTodo;
    }
    return null;
  }

  toggle(tid: string, completed: boolean): Todo | null {
    const tIndex = this.todos.findIndex((todo) => todo.id === tid);
    if (tIndex < 0) {
      return null;
    } else {
      const existTodo = this.todos.get(tIndex);
      const newTodo = existTodo.clone();
      newTodo.completed = completed;
      this.todos = this.todos.set(tIndex, newTodo.clone().makeImmutable());
      return newTodo;
    }
  }

  removeTodo(tid: string): Todo | null {
    const tIndex = this.todos.findIndex((todo) => todo.id === tid);
    if (tIndex < 0) {
      return null;
    } else {
      const oldTodo = this.todos.get(tIndex);
      this.todos = this.todos.remove(tIndex);
      return oldTodo;
    }
  }

  clearCompleted() {
    this.todos = List(this.todos.filter((todo) => !todo.completed));
    return this;
  }

  updateTabSpaceId(newTabSpaceId: string) {
    this.tabSpaceId = newTabSpaceId;
    this.todos = List(
      this.todos.map((todo) => {
        const newTodo = todo.clone();
        newTodo.tabSpaceId = newTabSpaceId;
        return newTodo.makeImmutable();
      }),
    );
    return this;
  }

  static fromSavedData(data: IAllTodoSavePayload) {
    const allTodo = new AllTodo(data.tabSpaceId);
    allTodo.cloneAttributes(data);
    return allTodo;
  }

  convertAndGetSavePayload(): {
    allTodoSavePayload: IAllTodoSavePayload;
    isNewAllTodo: boolean;
    newTodoSavePayloads: ITodoSavePayload[];
    existTodoSavePayloads: ITodoSavePayload[];
  } {
    const isNewAllTodo = isIdNotSaved(this.id);
    this.convertToSaved();
    const newTodoSavePayloads: ITodoSavePayload[] = [];
    const existTodoSavePayloads: ITodoSavePayload[] = [];
    this.todos = List(
      this.todos.map((todo) => {
        const savedTodo = todo.clone();
        const isNewTodo = isIdNotSaved(savedTodo.id);
        const todoSavePayload = savedTodo.convertAndGetSavePayload();
        if (isNewTodo) {
          newTodoSavePayloads.push(todoSavePayload);
        } else {
          existTodoSavePayloads.push(todoSavePayload);
        }
        return savedTodo.makeImmutable();
      }),
    );
    return {
      allTodoSavePayload: extend(super.toJSON(), {
        tabSpaceId: this.tabSpaceId,
        todoIds: this.todos.map((todo) => todo.id).toArray(),
      }),
      isNewAllTodo,
      newTodoSavePayloads,
      existTodoSavePayloads,
    };
  }
}
