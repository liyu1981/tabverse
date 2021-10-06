import { AllBookmark, Bookmark, IBookmarkJSON } from './bookmark';

import { db } from '../../store/db';
import { getLogger } from '../../store/store';
import { map } from 'lodash';

export async function dbAuditor(logs: string[]): Promise<void> {
  const logger = getLogger(logs);
  logger('bookmark dbAuditor start to process...');
  const bookmarksData = await db
    .table<IBookmarkJSON>(Bookmark.DB_TABLE_NAME)
    .toArray();
  const audit = async (bookmarkData: IBookmarkJSON) => {
    const c = await db
      .table(AllBookmark.DB_TABLE_NAME)
      .where('bookmarkIds')
      .anyOf(bookmarkData.id)
      .count();
    if (c > 0) {
      // found one, valid
    } else {
      logger(`bookmark ${bookmarkData.id} is an orphan, need to be purged.`);
      await db.table(Bookmark.DB_TABLE_NAME).delete(bookmarkData.id);
      logger(`bookmark ${bookmarkData.id} purged.`);
    }
  };
  await Promise.all(map(bookmarksData, (bookmarkData) => audit(bookmarkData)));
  logger('bookmark dbAuditor finished processing.');
}
