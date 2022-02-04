import { ISavedTab, Tab } from '../../data/tabSpace/Tab';
import { addToIndex, getContext } from '../../fullTextSearch';

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
    addToIndex(getContext(), {
      owner: savedTab.id,
      content: savedTab.title,
      type: SearchableType.Tab,
      field: SearchableField.Title,
    });
    addToIndex(getContext(), {
      owner: savedTab.id,
      content: savedTab.url,
      type: SearchableType.Tab,
      field: SearchableField.Url,
    });
  } catch (e) {
    logger.error(e.message);
  }
};
