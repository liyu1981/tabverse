import './todoApp.scss';

import * as React from 'react';

import { AllTodoData } from '../../data/todo/bootstrap';
import { List } from 'immutable';
import { Todo } from '../../data/todo/todo';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';

const RETURN_KEY = 13;
const FILTER_ACTIVE = 'active';
const FILTER_COMPLETED = 'completed';

interface ITodoItemProps {
  todo: Todo;
  changeFunc: (id: string, t: Todo) => void;
  removeFunc: (id: string) => void;
}

const TodoItem = (props: ITodoItemProps) => {
  const [editing, setEditing] = useState(false);
  const [currentEditValue, setCurrentEditValue] = useState(props.todo.content);
  return (
    <li
      className={[
        props.todo.completed ? 'completed' : '',
        editing ? 'editing' : '',
      ].join(' ')}
    >
      <div className="view">
        <input
          className="toggle"
          type="checkbox"
          checked={props.todo.completed}
          onClick={() => {
            const t = props.todo.clone();
            t.completed = !t.completed;
            props.changeFunc(props.todo.id, t);
          }}
          onChange={() => {}}
        />
        <label onDoubleClick={() => setEditing(true)}>
          {props.todo.content}
        </label>
        <button
          className="destroy"
          onClick={() => props.removeFunc(props.todo.id)}
        />
      </div>
      <input
        className="edit"
        defaultValue={currentEditValue}
        onBlur={() => {
          const t = props.todo.clone();
          t.content = currentEditValue;
          props.changeFunc(props.todo.id, t);
          setEditing(false);
        }}
        onChange={(event) => setCurrentEditValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.keyCode === RETURN_KEY) {
            const t = props.todo.clone();
            t.content = currentEditValue;
            props.changeFunc(props.todo.id, t);
            setEditing(false);
          }
        }}
      />
    </li>
  );
};

interface ITodoViewProps {
  allTodoData: AllTodoData;
}

export const TodoView = observer((props: ITodoViewProps) => {
  const [filter, setFilter] = useState<string | null>(null);
  const [currentInputValue, setCurrentInputValue] = useState<string | null>(
    null,
  );

  const changeTodo = (id: string, t: Todo) => {
    props.allTodoData.allTodo.updateTodo(id, t);
  };

  const removeTodo = (id: string) => {
    props.allTodoData.allTodo.removeTodo(id);
  };

  const filteredTodos = List<Todo>(
    props.allTodoData.allTodo.todos.filter((todo) => {
      switch (filter) {
        case FILTER_ACTIVE:
          return !todo.completed;
        case FILTER_COMPLETED:
          return todo.completed;
        default:
          return true;
      }
    }),
  );

  const todoItems = List(
    List<Todo>(
      filteredTodos.sort((ta: Todo, tb: Todo) => {
        return ta.completed > tb.completed
          ? 1
          : ta.completed === tb.completed
          ? 0
          : -1;
      }),
    ).map((todo) => (
      <TodoItem
        key={todo.id}
        todo={todo}
        changeFunc={changeTodo}
        removeFunc={removeTodo}
      />
    )),
  ).toArray();

  const main = (
    <section className="main">
      <input
        id="toggle-all"
        className="toggle-all"
        type="checkbox"
        checked={false}
        onChange={() => {}}
      />
      <label htmlFor="toggle-all">Mark all as complete</label>
      <ul className="todo-list">{todoItems}</ul>
    </section>
  );

  const header = (
    <header className="header">
      <input
        className="new-todo"
        placeholder="What needs to be done?"
        value={currentInputValue ?? ''}
        autoFocus={true}
        onKeyDown={(event) => {
          if (event.keyCode === RETURN_KEY) {
            const t = new Todo();
            t.content = currentInputValue;
            props.allTodoData.allTodo.addTodo(t);
            setCurrentInputValue(null);
          }
        }}
        onChange={(event) => {
          setCurrentInputValue(event.target.value);
        }}
      />
    </header>
  );

  const hasCompleted =
    props.allTodoData.allTodo.todos.findIndex((todo) => todo.completed) >= 0;

  const activeCount = props.allTodoData.allTodo.todos.count((todo) => {
    return !todo.completed;
  });

  const footer = (
    <footer className="footer">
      <span className="todo-count">
        <strong>{activeCount}</strong> left
      </span>
      <ul className="filters">
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
          className="clear-completed"
          onClick={() => {
            props.allTodoData.allTodo.clearCompleted();
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
    <div className="todoapp">
      {header}
      {main}
      {footer}
    </div>
  );
});
