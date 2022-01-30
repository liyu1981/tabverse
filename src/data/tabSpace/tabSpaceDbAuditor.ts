import { Tab, TabJSON } from './Tab';

import { TabSpace } from './TabSpace';
import { db } from '../../store/db';
import { getLogger } from '../../store/store';
import { map } from 'lodash';

export async function dbAuditor(logs: string[]): Promise<void> {
  const logger = getLogger(logs);
  logger('tabSpace dbAuditor start to process...');
  const tabsData = await db.table<TabJSON>(Tab.DB_TABLE_NAME).toArray();
  const auditTab = async (tabData: TabJSON) => {
    const c = await db
      .table(TabSpace.DB_TABLE_NAME)
      .where('tabIds')
      .anyOf(tabData.id)
      .count();
    if (c > 0) {
      // found one tabSpace, valid
    } else {
      logger(`tab ${tabData.id} is an orphan, need to be purged.`);
      await db.table(Tab.DB_TABLE_NAME).delete(tabData.id);
      logger(`tab ${tabData.id} purged.`);
    }
  };
  await Promise.all(map(tabsData, (tabData) => auditTab(tabData)));
  logger('tabSpace dbAuditor finished processing.');
}
