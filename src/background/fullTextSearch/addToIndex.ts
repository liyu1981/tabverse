import { addToIndex, getDb } from '../../fullTextSearch';

import { db } from '../../store/db';
import { logger } from '../../global';
import { TabCore, TAB_DB_TABLE_NAME } from '../../data/tabSpace/Tab';
import { querySavedTabSpaceById } from '../../data/tabSpace/util';

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

async function querySavedTabById(tabId: string): Promise<TabCore> {
  const savedTab = await db.table<TabCore>(TAB_DB_TABLE_NAME).get(tabId);
  return savedTab;
}

export const addToIndexHandlers = {};

export async function addTabToIndex(id: string) {
  try {
    const savedTab = await querySavedTabById(id);
    const db = getDb();
    await addToIndex(db, {
      owner: savedTab.id,
      ultimateOwner: savedTab.tabSpaceId,
      content: savedTab.title,
      type: SearchableType.Tab,
      field: SearchableField.Title,
    });
    await addToIndex(db, {
      owner: savedTab.id,
      ultimateOwner: savedTab.tabSpaceId,
      content: savedTab.url,
      type: SearchableType.Tab,
      field: SearchableField.Url,
    });
  } catch (e) {
    logger.error(e.message);
  }
}

addToIndexHandlers[SearchableType.Tab] = addTabToIndex;

export async function addTabSpaceToIndex(id: string) {
  try {
    const savedTabSpace = await querySavedTabSpaceById(id);
    const db = getDb();
    await addToIndex(db, {
      owner: savedTabSpace.id,
      ultimateOwner: savedTabSpace.id,
      content: savedTabSpace.name,
      type: SearchableType.TabSpace,
      field: SearchableField.Name,
    });
  } catch (e) {
    logger.error(e.message);
  }
}

addToIndexHandlers[SearchableType.TabSpace] = addTabSpaceToIndex;
