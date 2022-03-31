import { Tab, TAB_DB_TABLE_NAME } from './Tab';
import { TABSPACE_DB_TABLE_NAME } from './TabSpace';
import { db } from '../../storage/db';
import { map } from 'lodash';
import { getLogger } from '../../storage/dbAuditorManager';

export async function dbAuditor(logs: string[]): Promise<void> {
  const logger = getLogger(logs);
  logger('tabSpace dbAuditor start to process...');
  const tabsData = await db.table<Tab>(TAB_DB_TABLE_NAME).toArray();
  const auditTab = async (tabData: Tab) => {
    const c = await db
      .table(TABSPACE_DB_TABLE_NAME)
      .where('tabIds')
      .anyOf(tabData.id)
      .count();
    if (c > 0) {
      // found one tabSpace, valid
    } else {
      logger(`tab ${tabData.id} is an orphan, need to be purged.`);
      await db.table(TAB_DB_TABLE_NAME).delete(tabData.id);
      logger(`tab ${tabData.id} purged.`);
    }
  };
  await Promise.all(map(tabsData, (tabData) => auditTab(tabData)));
  logger('tabSpace dbAuditor finished processing.');
}
