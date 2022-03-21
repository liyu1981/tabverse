import { Todo, TODO_DB_TABLE_NAME } from './Todo';

import { db } from '../../store/db';
import { getLogger } from '../../store/store';
import { map } from 'lodash';
import { AllTodoSavePayload, ALLTODO_DB_TABLE_NAME } from './AllTodo';

export async function dbAuditor(logs: string[]): Promise<void> {
  const logger = getLogger(logs);
  logger('todo dbAuditor start to process...');
  const todosData = await db.table<Todo>(TODO_DB_TABLE_NAME).toArray();
  const audit = async (savedTodo: Todo) => {
    const c = await db
      .table<AllTodoSavePayload>(ALLTODO_DB_TABLE_NAME)
      .where('todoIds')
      .anyOf(savedTodo.id)
      .count();
    if (c > 0) {
      // found one, valid
    } else {
      logger(`todo ${savedTodo.id} is an orphan, need to be purged.`);
      await db.table(TODO_DB_TABLE_NAME).delete(savedTodo.id);
      logger(`todo ${savedTodo.id} purged.`);
    }
  };
  await Promise.all(map(todosData, (todoData) => audit(todoData)));
  logger('todo dbAuditor finished processing.');
}
