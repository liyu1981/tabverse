import { AllTodo, ITodoJSON, Todo } from './Todo';

import { db } from '../../store/db';
import { getLogger } from '../../store/store';
import { map } from 'lodash';

export async function dbAuditor(logs: string[]): Promise<void> {
  const logger = getLogger(logs);
  logger('todo dbAuditor start to process...');
  const todosData = await db.table<ITodoJSON>(Todo.DB_TABLE_NAME).toArray();
  const audit = async (todoData: ITodoJSON) => {
    const c = await db
      .table(AllTodo.DB_TABLE_NAME)
      .where('todoIds')
      .anyOf(todoData.id)
      .count();
    if (c > 0) {
      // found one, valid
    } else {
      logger(`todo ${todoData.id} is an orphan, need to be purged.`);
      await db.table(Todo.DB_TABLE_NAME).delete(todoData.id);
      logger(`todo ${todoData.id} purged.`);
    }
  };
  await Promise.all(map(todosData, (todoData) => audit(todoData)));
  logger('todo dbAuditor finished processing.');
}
