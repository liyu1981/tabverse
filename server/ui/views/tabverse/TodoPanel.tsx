import React, { useState } from 'react';

import todoClasses from '../../../../src/ui/todo/TodoView.module.scss';
import type { Todo } from '../../data/tabverseAdapter';

/**
 * The extension's todo list, read.
 *
 * Same rows, same CSS module (`TodoView.module.scss` - the TodoMVC styles), same
 * circle for "done" and strike-through for "completed". What is gone is every
 * way to change one: the "What needs to be done?" box, "Mark all as complete",
 * the delete-cross on hover, double-click-to-edit, and "Clear completed". The
 * filters and the count stay, because they only change what is *shown* and a
 * list of forty todos is a list an operator reads in two passes.
 */
const FILTER_ALL = 'all';
const FILTER_ACTIVE = 'active';
const FILTER_COMPLETED = 'completed';

export function TodoPanel(props: { todos: Todo[] }) {
  const [filter, setFilter] = useState<string>(FILTER_ALL);

  const visible = props.todos.filter((todo) => {
    if (filter === FILTER_ACTIVE) return !todo.completed;
    if (filter === FILTER_COMPLETED) return todo.completed;
    return true;
  });

  const activeCount = props.todos.filter((todo) => !todo.completed).length;

  const items = visible
    .slice()
    .sort((a, b) => (a.completed === b.completed ? 0 : a.completed ? 1 : -1))
    .map((todo) => (
      <li key={todo.id} className={todo.completed ? todoClasses.completed : ''}>
        <div className={todoClasses.view}>
          {/* The circle is the todomvc stylesheet's background on the row, keyed
              off this checkbox's `:checked`. It is disabled, not interactive:
              the circle is the state, not a control. */}
          <input
            className={todoClasses.toggle}
            type="checkbox"
            checked={todo.completed}
            disabled={true}
            readOnly={true}
            aria-label={todo.completed ? 'completed' : 'not completed'}
          />
          <span className={todoClasses.content}>{todo.content}</span>
        </div>
      </li>
    ));

  return (
    <div className={todoClasses.todoapp}>
      <section className={todoClasses.main}>
        <ul className={todoClasses.todoList}>{items}</ul>
      </section>
      <footer className={todoClasses.footer}>
        <span className={todoClasses.todoCount}>
          <strong>{activeCount}</strong> left
        </span>
        <ul className={todoClasses.filters}>
          <li key={FILTER_ALL}>
            <button
              type="button"
              className={filter === FILTER_ALL ? todoClasses.selected : ''}
              onClick={() => setFilter(FILTER_ALL)}
            >
              All
            </button>
          </li>
          <li key={FILTER_ACTIVE}>
            <button
              type="button"
              className={filter === FILTER_ACTIVE ? todoClasses.selected : ''}
              onClick={() => setFilter(FILTER_ACTIVE)}
            >
              Active
            </button>
          </li>
          <li key={FILTER_COMPLETED}>
            <button
              type="button"
              className={
                filter === FILTER_COMPLETED ? todoClasses.selected : ''
              }
              onClick={() => setFilter(FILTER_COMPLETED)}
            >
              Completed
            </button>
          </li>
        </ul>
      </footer>
    </div>
  );
}
