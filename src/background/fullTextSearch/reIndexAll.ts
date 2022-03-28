import { addTabSpaceToIndex, addTabToIndex } from './addToIndex';

import { TaskQueue } from '../TaskQueue';
import { db } from '../../store/db';
import { logger } from '../../global';
import {
  TabSpaceSavePayload,
  TABSPACE_DB_TABLE_NAME,
} from '../../data/tabSpace/TabSpace';
import { TAB_DB_TABLE_NAME } from '../../data/tabSpace/Tab';

async function reIndexAllSavedTabSpace() {
  const taskQueue = new TaskQueue();
  await db.transaction(
    'readonly',
    [TABSPACE_DB_TABLE_NAME, TAB_DB_TABLE_NAME],
    async (tx) => {
      await db
        .table<TabSpaceSavePayload>(TABSPACE_DB_TABLE_NAME)
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
