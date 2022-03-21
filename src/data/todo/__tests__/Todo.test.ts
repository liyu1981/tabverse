/* eslint-disable prefer-const */
import {
  addTodo,
  clearCompleted,
  convertAndGetAllTodoSavePayload,
  newEmptyAllTodo,
  removeTodo,
  toggle,
  updateTabSpaceId,
  updateTodo,
} from '../AllTodo';
import { convertToSavedTodo, newEmptyTodo, setContent } from '../Todo';

import { isIdNotSaved } from '../../common';

function initAllTodo() {
  const tabSpaceId = 'hello';
  let allTodo = updateTabSpaceId(tabSpaceId, newEmptyAllTodo());

  const t1 = setContent('test1', newEmptyTodo());
  const t2 = setContent('test2', newEmptyTodo());

  allTodo = addTodo(t1, allTodo);
  allTodo = addTodo(t2, allTodo);

  return { tabSpaceId, allTodo, t1, t2 };
}

test('init & addTodo', () => {
  const { tabSpaceId, allTodo, t1, t2 } = initAllTodo();

  expect(allTodo.todos.size).toEqual(2);
  expect(allTodo.tabSpaceId).toEqual(tabSpaceId);
  expect(allTodo.todos.get(0).tabSpaceId).toEqual(tabSpaceId);
  expect(allTodo.todos.get(1).tabSpaceId).toEqual(tabSpaceId);
});

test('updateTodo', () => {
  let { tabSpaceId, allTodo, t1, t2 } = initAllTodo();

  const t3 = setContent('test3', newEmptyTodo());
  allTodo = addTodo(t3, allTodo);
  const newId = t3.id + 'not this';
  const newContent = t3.content + 'changed';

  allTodo = updateTodo(newId, { content: newContent }, allTodo);
  expect(allTodo.todos.find((todo) => todo.id === newId)).toBe(undefined);

  allTodo = updateTodo(t3.id, { content: newContent }, allTodo);
  expect(allTodo.todos.get(2).content).toEqual(newContent);
});

test('toggle', () => {
  let { tabSpaceId, allTodo, t1, t2 } = initAllTodo();

  allTodo = toggle('888', true, allTodo);
  expect(
    allTodo.todos.countBy((todo) => (todo.completed ? 1 : 0)).toJS(),
  ).toEqual({ '0': 2 });

  allTodo = toggle(t2.id, true, allTodo);
  expect(
    allTodo.todos.countBy((todo) => (todo.completed ? 1 : 0)).toJS(),
  ).toEqual({ '0': 1, '1': 1 });
});

test('removeTodo & clearCompleted', () => {
  let { tabSpaceId, allTodo, t1, t2 } = initAllTodo();

  allTodo = removeTodo('888', allTodo);
  expect(allTodo.todos.size).toEqual(2);

  allTodo = removeTodo(t2.id, allTodo);
  expect(allTodo.todos.size).toEqual(1);

  allTodo = toggle(t1.id, true, allTodo);
  allTodo = clearCompleted(allTodo);
  expect(allTodo.todos.size).toEqual(0);
});

test('updateTabSpaceId', () => {
  let { tabSpaceId, allTodo, t1, t2 } = initAllTodo();
  const newTabSpaceId = tabSpaceId + 'new';
  allTodo = updateTabSpaceId(newTabSpaceId, allTodo);
  expect(allTodo.todos.map((todo) => todo.tabSpaceId).toArray()).toEqual([
    newTabSpaceId,
    newTabSpaceId,
  ]);
});

test('convertToSavedTodo', () => {
  let { tabSpaceId, allTodo, t1, t2 } = initAllTodo();
  const t2payload = convertToSavedTodo(t2);
  expect(isIdNotSaved(t2payload.id)).toBeFalsy();
});

test('allTodo', () => {
  let { tabSpaceId, allTodo, t1, t2 } = initAllTodo();
  const {
    allTodo: savedAllTodo,
    allTodoSavePayload,
    isNewAllTodo,
    newTodoSavePayloads,
    existTodoSavePayloads,
  } = convertAndGetAllTodoSavePayload(allTodo);
  allTodoSavePayload.todoIds.forEach((todoId) =>
    expect(isIdNotSaved(todoId)).toBeFalsy(),
  );
  expect(isNewAllTodo).toBeTruthy();
  expect(allTodoSavePayload.todoIds).toEqual(
    savedAllTodo.todos.map((todo) => todo.id).toArray(),
  );
  expect(allTodoSavePayload.todoIds).toEqual(
    newTodoSavePayloads.map((todoSavePayload) => todoSavePayload.id),
  );
  expect(existTodoSavePayloads.length).toEqual(0);
});
