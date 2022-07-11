import { $allTodo, todoStoreApi } from '../../data/todo/store';
import React, { useEffect, useState } from 'react';
import { Todo, setCompleted } from '../../data/todo/Todo';
import {
  monitorTabSpaceChanges,
  saveCurrentAllTodoIfNeeded,
  startMonitorLocalStorageChanges,
  stopMonitorLocalStorageChanges,
} from '../../data/todo/util';
import { newEmptyTodo, setContent } from '../../data/todo/Todo';

import classes from './TodoView.module.scss';
import clsx from 'clsx';
import { isIdNotSaved } from '../../data/common';
import { logger } from '../../global';
import { useStore } from 'effector-react';

const RETURN_KEY = 13;
const FILTER_ACTIVE = 'active';
const FILTER_COMPLETED = 'completed';

interface TodoItemViewProps {
  todo: Todo;
  changeFunc: (id: string, t: Todo) => void;
  removeFunc: (id: string) => void;
}

const TodoItemView = (props: TodoItemViewProps) => {
  const [editing, setEditing] = useState(false);
  const [currentEditValue, setCurrentEditValue] = useState(props.todo.content);
  return (
    <li
      className={clsx(
        props.todo.completed ? classes.completed : '',
        editing ? classes.editing : '',
      )}
    >
      <div className={classes.view}>
        <input
          className={classes.toggle}
          type="checkbox"
          checked={props.todo.completed}
          onClick={() => {
            props.changeFunc(
              props.todo.id,
              setCompleted(!props.todo.completed, props.todo),
            );
          }}
          onChange={() => {}}
        />
        <label onDoubleClick={() => setEditing(true)}>
          {props.todo.content}
        </label>
        <button
          className={classes.destroy}
          onClick={() => props.removeFunc(props.todo.id)}
        />
      </div>
      <input
        className={classes.edit}
        defaultValue={currentEditValue}
        onBlur={() => {
          props.changeFunc(
            props.todo.id,
            setContent(currentEditValue, props.todo),
          );
          setEditing(false);
        }}
        onChange={(event) => setCurrentEditValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.keyCode === RETURN_KEY) {
            props.changeFunc(
              props.todo.id,
              setContent(currentEditValue, props.todo),
            );
            setEditing(false);
          }
        }}
      />
    </li>
  );
};

export interface TodoViewProps {
  tabSpaceId: string;
}

export function TodoView({ tabSpaceId }: TodoViewProps) {
  const allTodo = useStore($allTodo);

  const [filter, setFilter] = useState<string | null>(null);
  const [currentInputValue, setCurrentInputValue] = useState<string | null>(
    null,
  );

  useEffect(() => {
    logger.info('todo start monitor tabspace, alltodo changes');
    monitorTabSpaceChanges();
  }, []);

  useEffect(() => {
    if (tabSpaceId && isIdNotSaved(tabSpaceId)) {
      logger.info('todo start monitor localstorage changes');
      startMonitorLocalStorageChanges();
      return () => {
        logger.info('todo stop monitor localstorage changes');
        stopMonitorLocalStorageChanges();
      };
    }
  }, [tabSpaceId]);

  const changeTodo = (id: string, t: Todo) => {
    todoStoreApi.updateTodo({ tid: id, changes: t });
    saveCurrentAllTodoIfNeeded();
  };

  const removeTodo = (id: string) => {
    todoStoreApi.removeTodo(id);
    saveCurrentAllTodoIfNeeded();
  };

  const filteredTodos = allTodo.todos
    .filter((todo) => {
      switch (filter) {
        case FILTER_ACTIVE:
          return !todo.completed;
        case FILTER_COMPLETED:
          return todo.completed;
        default:
          return true;
      }
    })
    .toList();

  const todoItems = filteredTodos
    .sort((ta: Todo, tb: Todo) => {
      return ta.completed > tb.completed
        ? 1
        : ta.completed === tb.completed
        ? 0
        : -1;
    })
    .toArray()
    .map((todo) => (
      <TodoItemView
        key={todo.id}
        todo={todo}
        changeFunc={changeTodo}
        removeFunc={removeTodo}
      />
    ));

  const main = (
    <section className={classes.main}>
      <input
        id="toggle-all"
        className={classes.toggleAll}
        type="checkbox"
        checked={false}
        onChange={() => {}}
      />
      <label htmlFor="toggle-all">Mark all as complete</label>
      <ul className={classes.todoList}>{todoItems}</ul>
    </section>
  );

  const header = (
    <header className={classes.header}>
      <input
        className={classes.newTodo}
        placeholder="What needs to be done?"
        value={currentInputValue ?? ''}
        autoFocus={true}
        onKeyDown={(event) => {
          if (event.keyCode === RETURN_KEY) {
            const t = setContent(currentInputValue, newEmptyTodo());
            todoStoreApi.addTodo(t);
            setCurrentInputValue(null);
          }
        }}
        onChange={(event) => {
          setCurrentInputValue(event.target.value);
        }}
      />
    </header>
  );

  const hasCompleted = allTodo.todos.findIndex((todo) => todo.completed) >= 0;

  const activeCount = allTodo.todos.count((todo) => {
    return !todo.completed;
  });

  const footer = (
    <footer className={classes.footer}>
      <span className={classes.todoCount}>
        <strong>{activeCount}</strong> left
      </span>
      <ul className={classes.filters}>
        <li key="all">
          <a href="#" onClick={() => setFilter(null)}>
            All
          </a>
        </li>{' '}
        <li key="active">
          <a href="#" onClick={() => setFilter(FILTER_ACTIVE)}>
            Active
          </a>
        </li>{' '}
        <li key="completed">
          <a href="#" onClick={() => setFilter(FILTER_COMPLETED)}>
            Completed
          </a>
        </li>
      </ul>
      {hasCompleted ? (
        <button
          className={classes.clearCompleted}
          onClick={() => {
            todoStoreApi.clearCompleted();
          }}
        >
          Clear completed
        </button>
      ) : (
        <></>
      )}
    </footer>
  );

  return (
    <div className={classes.todoapp}>
      {header}
      {main}
      {footer}
    </div>
  );
}
