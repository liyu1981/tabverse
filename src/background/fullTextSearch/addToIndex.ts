import { ISavedTab, Tab } from '../../data/tabSpace/Tab';
import { addToIndex, getContext, removeFromIndex } from '../../fullTextSearch';

import { db } from '../../store/db';
import { logger } from '../../global';

export enum SearchableType {
  Tab = 'tab',
  TabSpace = 'tabSpace',
  Todo = 'todo',
  Note = 'note',
  Bookmark = 'bookmark',
}

export enum SearchableField {
  Title = 'title',
  Url = 'url',
  Name = 'name',
}

async function querySavedTabById(tabId: string): Promise<ISavedTab> {
  const savedTab = await db.table<ISavedTab>(Tab.DB_TABLE_NAME).get(tabId);
  return savedTab;
}

export const addToIndexHandlers = {};

addToIndexHandlers[SearchableType.Tab] = async (type: string, id: string) => {
  try {
    const savedTab = await querySavedTabById(id);
    const ctx = getContext();
    // we try to remove the old index first then add them back, so that from the
    // outside view, addToIndex is repeatable.
    await removeFromIndex(ctx, { owner: savedTab.id });
    await addToIndex(ctx, {
      owner: savedTab.id,
      content: savedTab.title,
      type: SearchableType.Tab,
      field: SearchableField.Title,
    });
    await addToIndex(ctx, {
      owner: savedTab.id,
      content: savedTab.url,
      type: SearchableType.Tab,
      field: SearchableField.Url,
    });
  } catch (e) {
    logger.error(e.message);
  }
};
