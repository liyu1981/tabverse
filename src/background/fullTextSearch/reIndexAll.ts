import { ISavedTabSpace, TabSpace } from '../../data/tabSpace/TabSpace';

import { Tab } from '../../data/tabSpace/Tab';
import { addTabToIndex } from './addToIndex';
import { db } from '../../store/db';
import { logger } from '../../global';

async function reIndexAllSavedTab() {
  db.transaction(
    'readonly',
    [TabSpace.DB_TABLE_NAME, Tab.DB_TABLE_NAME],
    async (tx) => {
      await db
        .table<ISavedTabSpace>(TabSpace.DB_TABLE_NAME)
        .toCollection()
        .each(async (tabSpace) => {
          logger.info(
            `will reindex tabspace ${tabSpace.id} tabids: ${tabSpace.tabIds}`,
          );
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
  reIndexAllSavedTab();
}
