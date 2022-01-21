import { bootstrap, getAllTodoData, loadByTabSpaceId } from '../bootstrap';
import {
  getTabSpaceData,
  bootstrap as tabSpaceBootstrap,
} from '../../tabSpace/bootstrap';
import { queryAllTodo, saveCurrentAllTodo } from '../todoStore';

import { Todo } from '../todo';
import { initTabSpaceData } from '../../tabSpace/__tests__/tabSpaceStore.test';
import { testWithDb } from '../../tabSpace/__tests__/tabSpaceStore.test';

async function bootstrapAllTodo() {
  const { tst1 } = await initTabSpaceData();
  await tabSpaceBootstrap(tst1.id, tst1.windowId);
  const tabSpaceId = getTabSpaceData().tabSpace.id;
  bootstrap();
  await loadByTabSpaceId(tabSpaceId);
  return { tabSpaceId };
}

test('todoStore', async () => {
  await testWithDb('save new', async () => {
    const { tabSpaceId } = await bootstrapAllTodo();
    const { allTodo } = getAllTodoData();
    const t1 = new Todo();
    t1.content = 'test1';
    const t2 = new Todo();
    t2.content = 'test2';
    allTodo.addTodo(t1);
    allTodo.addTodo(t2);
    await saveCurrentAllTodo();
    const allTodo2 = await queryAllTodo(allTodo.tabSpaceId);
    expect(allTodo2.toJSON()).toEqual(allTodo.toJSON());
    allTodo2.todos.forEach((todo) => {
      const tIndex = allTodo.todos.findIndex((t) => t.id === todo.id);
      expect(tIndex).toBeGreaterThanOrEqual(0);
      const t = allTodo.todos.get(tIndex);
      expect(t.toJSON()).toEqual(todo.toJSON());
    });
  });

  await testWithDb('save exist', async () => {
    const { tabSpaceId } = await bootstrapAllTodo();
    const { allTodo } = getAllTodoData();
    const t1 = new Todo();
    t1.content = 'test1';
    const t2 = new Todo();
    t2.content = 'test2';
    allTodo.addTodo(t1);
    allTodo.addTodo(t2);
    await saveCurrentAllTodo();
    const changedContent = t1.content + 'changed';
    allTodo.updateTodo(allTodo.todos.get(0).id, { content: changedContent });
    allTodo.toggle(allTodo.todos.get(1).id, true);
    await saveCurrentAllTodo();
    const allTodo3 = await queryAllTodo(allTodo.tabSpaceId);
    expect(allTodo3.todos.get(0).content).toEqual(changedContent);
    expect(allTodo3.todos.get(1).completed).toBeTruthy();
  });
});
