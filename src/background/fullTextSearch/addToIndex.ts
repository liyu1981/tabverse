import { ISavedTab, Tab } from '../../data/tabSpace/Tab';
import { addToIndex, getContext, removeFromIndex } from '../../fullTextSearch';

import { db } from '../../store/db';
import { logger } from '../../global';
import { querySavedTabSpaceById } from '../../data/tabSpace/SavedTabSpaceStore';

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

export async function addTabToIndex(id: string) {
  try {
    const savedTab = await querySavedTabById(id);
    const ctx = getContext();
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
}

addToIndexHandlers[SearchableType.Tab] = addTabToIndex;

async function addTabSpaceToIndex(id: string) {
  try {
    const savedTabSpace = await querySavedTabSpaceById(id);
    const ctx = getContext();
    await addToIndex(ctx, {
      owner: savedTabSpace.id,
      content: savedTabSpace.name,
      type: SearchableType.TabSpace,
      field: SearchableField.Title,
    });
    await Promise.all(
      savedTabSpace.tabIds.map((tabId) => addTabToIndex(tabId)),
    );
  } catch (e) {
    logger.error(e.message);
  }
}

addToIndexHandlers[SearchableType.TabSpace] = addTabSpaceToIndex;
