import { getDb, removeFromIndex } from '../../fullTextSearch';

import { logger } from '../../global';
import { SearchableType } from './addToIndex';

export const removeFromIndexHandlers = {};

async function removeTabFromIndex(tabId: string) {
  try {
    await removeFromIndex(getDb(), { owner: tabId });
  } catch (e) {
    logger.error(e.message);
  }
}

removeFromIndexHandlers[SearchableType.Tab] = removeTabFromIndex;

async function removeTabSpaceFromIndex(tabSpaceId: string) {
  try {
    await removeFromIndex(getDb(), { ultimateOwner: tabSpaceId });
  } catch (e) {
    logger.error(e.message);
  }
}

removeFromIndexHandlers[SearchableType.TabSpace] = removeTabSpaceFromIndex;
