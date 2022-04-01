import { newEmptyTodo, setContent } from '../Todo';
import { queryAllTodo, saveCurrentAllTodo } from '../util';
import { $allTodo, todoStoreApi } from '../store';
import { omit } from 'lodash';
import { newEmptyAllTodo } from '../AllTodo';
import {
  initTabSpaceData,
  testWithDb,
} from '../../tabSpace/__tests__/store.test';
import { $tabSpace } from '../../tabSpace/store';

async function bootstrapAllTodo() {
  await initTabSpaceData();
  const tabSpaceId = $tabSpace.getState().id;
  todoStoreApi.update(newEmptyAllTodo());
  todoStoreApi.updateTabSpaceId(tabSpaceId);
  return { tabSpaceId };
}

test('todoStore', async () => {
  await testWithDb('save new', async () => {
    const { tabSpaceId } = await bootstrapAllTodo();
    todoStoreApi.addTodo(setContent('test1', newEmptyTodo()));
    todoStoreApi.addTodo(setContent('test2', newEmptyTodo()));
    await saveCurrentAllTodo();

    const allTodo2 = await queryAllTodo(tabSpaceId);
    expect(omit(allTodo2, 'todos')).toEqual(omit($allTodo.getState(), 'todos'));
    allTodo2.todos.forEach((todo) => {
      const tIndex = $allTodo
        .getState()
        .todos.findIndex((t) => t.id === todo.id);
      expect(tIndex).toBeGreaterThanOrEqual(0);
      const t = $allTodo.getState().todos.get(tIndex);
      expect(t).toEqual(todo);
    });
  });

  await testWithDb('save exist', async () => {
    const { tabSpaceId } = await bootstrapAllTodo();
    todoStoreApi.addTodo(setContent('test1', newEmptyTodo()));
    todoStoreApi.addTodo(setContent('test2', newEmptyTodo()));
    await saveCurrentAllTodo();

    const t1 = $allTodo.getState().todos.get(0);
    const t2 = $allTodo.getState().todos.get(1);
    const changedContent = t1.content + 'changed';
    todoStoreApi.updateTodo({
      tid: t1.id,
      changes: { content: changedContent },
    });
    todoStoreApi.toggle({ tid: t2.id, completed: true });
    await saveCurrentAllTodo();
    const allTodo3 = await queryAllTodo(tabSpaceId);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect($allTodo.getState().todos.get(0).content).toEqual(changedContent);
    expect(allTodo3.todos.get(0).content).toEqual(changedContent);
    expect(allTodo3.todos.get(1).completed).toBeTruthy();
  });
});
