import { CLOSED_TAB_DB_TABLE_NAME, ClosedTab } from './ClosedTab';

import { TABSPACE_DB_TABLE_NAME } from '../tabSpace/TabSpace';
import { db } from '../../storage/db';
import { getLogger } from '../../storage/dbAuditorManager';

/**
 * Closed tab history rows outlive their tabverse when a tabverse is deleted
 * (the delete path does not walk the right side tools yet), and a tabverse id
 * that never reaches the server again would leave its history behind forever.
 * So: a history row whose tabspace is gone from the database is purged.
 */
export async function dbAuditor(logs: string[]): Promise<void> {
  const logger = getLogger(logs);
  logger('closed tab dbAuditor start to process...');
  const closedTabs = await db
    .table<ClosedTab>(CLOSED_TAB_DB_TABLE_NAME)
    .toArray();
  const liveTabSpaceIds = new Set(
    (
      await db
        .table<{ id: string }>(TABSPACE_DB_TABLE_NAME)
        .toCollection()
        .primaryKeys()
    ).map((id) => String(id)),
  );
  const orphans = closedTabs.filter(
    (closedTab) => !liveTabSpaceIds.has(closedTab.tabSpaceId),
  );
  for (const orphan of orphans) {
    logger(`closed tab ${orphan.id} is an orphan, need to be purged.`);
    await db.table(CLOSED_TAB_DB_TABLE_NAME).delete(orphan.id);
  }
  logger(
    `closed tab dbAuditor finished processing, purged ${orphans.length} row(s).`,
  );
}
