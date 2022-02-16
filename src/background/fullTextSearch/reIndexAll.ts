import { ISavedTabSpace, TabSpace } from '../../data/tabSpace/TabSpace';

import { Tab } from '../../data/tabSpace/Tab';
import { addTabToIndex } from './addToIndex';
import { db } from '../../store/db';
import { logger } from '../../global';
import { addTabSpaceToIndex } from './api';

async function reIndexAllSavedTabSpace() {
  db.transaction(
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
          await addTabSpaceToIndex(tabSpace.id);
          await Promise.all(
            tabSpace.tabIds.map((tabId) => {
              logger.info(`will re index tab ${tabId}`);
              addTabToIndex(tabId);
            }),
          );
        });
    },
  );
}

export function reIndexAll() {
  reIndexAllSavedTabSpace();
}
