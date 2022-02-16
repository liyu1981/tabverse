import { ISavedTabSpace, TabSpace } from '../../data/tabSpace/TabSpace';
import { addTabSpaceToIndex, addTabToIndex } from './addToIndex';

import { Tab } from '../../data/tabSpace/Tab';
import { TaskQueue } from '../taskQueue';
import { db } from '../../store/db';
import { logger } from '../../global';

async function reIndexAllSavedTabSpace() {
  const taskQueue = new TaskQueue();
  await db.transaction(
    'readonly',
    [TabSpace.DB_TABLE_NAME, Tab.DB_TABLE_NAME],
    async (tx) => {
      await db
        .table<ISavedTabSpace>(TabSpace.DB_TABLE_NAME)
        .toCollection()
        .each(async (tabSpace) => {
          logger.info(
            `will re-index tabspace ${tabSpace.id} tab ids: ${tabSpace.tabIds}`,
          );
          taskQueue.enqueue(async () => await addTabSpaceToIndex(tabSpace.id));
          tabSpace.tabIds.forEach((tabId) => {
            logger.info(`will re index tab ${tabId}`);
            taskQueue.enqueue(async () => await addTabToIndex(tabId));
          });
        });
    },
  );
  taskQueue.run();
}

export function reIndexAll() {
  reIndexAllSavedTabSpace();
}
