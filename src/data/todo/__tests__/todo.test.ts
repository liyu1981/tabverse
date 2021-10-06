import { AllTodo, ITodoJSON, Todo } from '../todo';

import { isIdNotSaved } from '../../common';
import { typeGuard } from '../../../global';

function initAllTodo() {
  const tabSpaceId = 'hello';
  const allTodo = new AllTodo(tabSpaceId);
  expect(allTodo.tabSpaceId).toEqual(tabSpaceId);
  expect(allTodo.todos.size).toEqual(0);

  const t1 = new Todo();
  t1.content = 'test1';
  const t2 = new Todo();
  t2.content = 'test2';

  allTodo.addTodo(t1);
  allTodo.addTodo(t2);

  return { tabSpaceId, allTodo, t1, t2 };
}

test('init & addTodo', () => {
  const { tabSpaceId, allTodo, t1, t2 } = initAllTodo();

  expect(allTodo.todos.size).toEqual(2);
  expect(allTodo.todos.get(0).tabSpaceId).toEqual(tabSpaceId);
  expect(allTodo.todos.get(1).tabSpaceId).toEqual(tabSpaceId);
});

test('updateTodo', () => {
  const { tabSpaceId, allTodo, t1, t2 } = initAllTodo();

  const t3 = new Todo();
  t3.content = 'test3';

  allTodo.addTodo(t3);
  const newContent = t3.content + 'changed';
  expect(
    allTodo.updateTodo(t3.id + 'not this', { content: newContent }),
  ).toBeNull();
  allTodo.updateTodo(t3.id, { content: newContent });
  expect(allTodo.todos.get(2).content).toEqual(newContent);
});

test('toggle', () => {
  const { tabSpaceId, allTodo, t1, t2 } = initAllTodo();
  allTodo.toggle('888', true);
  expect(
    allTodo.todos.countBy((todo) => (todo.completed ? 1 : 0)).toJS(),
  ).toEqual({ '0': 2 });
  allTodo.toggle(t2.id, true);
  expect(
    allTodo.todos.countBy((todo) => (todo.completed ? 1 : 0)).toJS(),
  ).toEqual({ '0': 1, '1': 1 });
});

test('removeTodo & clearCompleted', () => {
  const { tabSpaceId, allTodo, t1, t2 } = initAllTodo();
  allTodo.removeTodo('888');
  expect(allTodo.todos.size).toEqual(2);
  allTodo.removeTodo(t2.id);
  expect(allTodo.todos.size).toEqual(1);
  allTodo.toggle(t1.id, true);
  allTodo.clearCompleted();
  expect(allTodo.todos.size).toEqual(0);
});

test('updateTabSpaceId', () => {
  const { tabSpaceId, allTodo, t1, t2 } = initAllTodo();
  const newTabSpaceId = tabSpaceId + 'new';
  allTodo.updateTabSpaceId(newTabSpaceId);
  expect(allTodo.todos.map((todo) => todo.tabSpaceId).toArray()).toEqual([
    newTabSpaceId,
    newTabSpaceId,
  ]);
});

test('todo', () => {
  const { tabSpaceId, allTodo, t1, t2 } = initAllTodo();
  const t3 = t1.clone();
  expect(t3.toJSON()).toEqual(t1.toJSON());
  expect(typeGuard<ITodoJSON>(t3.toJSON())).toBeTruthy();
  const t3payload = t3.convertAndGetSavePayload();
  expect(isIdNotSaved(t3payload.id)).toBeFalsy();
  const t4 = Todo.fromJSON(t3payload);
  expect(t4.toJSON()).toEqual(t3.toJSON());
});

test('allTodo', () => {
  const { tabSpaceId, allTodo, t1, t2 } = initAllTodo();
  const {
    allTodoSavePayload,
    isNewAllTodo,
    newTodoSavePayloads,
    existTodoSavePayloads,
  } = allTodo.convertAndGetSavePayload();
  allTodoSavePayload.todoIds.forEach((todoId) =>
    expect(isIdNotSaved(todoId)).toBeFalsy(),
  );
  expect(isNewAllTodo).toBeTruthy();
  expect(allTodoSavePayload.todoIds).toEqual(
    newTodoSavePayloads.map((todoSavePayload) => todoSavePayload.id),
  );
  expect(existTodoSavePayloads.length).toEqual(0);
});
