import { FullTextSearchMsg, sendChromeMessage } from '../message';
import {
  IFullTextAddToIndexParam,
  IFullTextRemoveFromIndexParam,
  IFullTextSearchState,
  OWNER_INDEX_NAME,
  STORE_NAME,
  indexedDBRequestPromise,
} from './common';

import { flatten } from 'lodash';
import { getContext } from './context';
import { getNewId } from '../data/common';
import { getTabSpaceData } from '../data/tabSpace/bootstrap';
import { getWindow } from '../store/localSetting';
import { isDebug } from '../debug';
import { logger } from '../global';
import { search } from './search';
import { tokenize } from './tokenize';

export async function addToIndex(
  state: IFullTextSearchState,
  param: IFullTextAddToIndexParam,
) {
  const { terms } = await tokenize(param.content);
  const tx = state.db.transaction([STORE_NAME], 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const indexEntry = {
    id: getNewId(),
    owner: param.owner,
    type: param.type,
    field: param.field,
    terms: terms,
  };
  logger.log('addToIndex will store:', indexEntry);
  await indexedDBRequestPromise(store.put(indexEntry));
  tx.commit();
}

export async function removeFromIndex(
  state: IFullTextSearchState,
  param: IFullTextRemoveFromIndexParam,
) {
  const { owner } = param;
  const tx = state.db.transaction([STORE_NAME], 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const index = store.index(OWNER_INDEX_NAME);
  const allKeys = await indexedDBRequestPromise<IDBValidKey[]>(
    index.getAllKeys(owner),
  );
  await Promise.all(
    allKeys.map((key) => indexedDBRequestPromise(store.delete(key))),
  );
  tx.commit();
}

if (isDebug() && getWindow()) {
  // @ts-ignore
  getWindow().fulltext = {
    getContext,
    addToIndex,
    search,

    triggerAddToIndex: (id: string, type: string) => {
      sendChromeMessage({
        type: FullTextSearchMsg.AddToIndex,
        payload: { type, id },
      });
    },

    triggerReindexAllSavedTabSpaces: async () => {
      const allTabIds = flatten(
        getTabSpaceData().savedTabSpaceCollection.savedTabSpaces.map(
          (savedTabSpace) => {
            return savedTabSpace.tabs.map((tab) => tab.id).toArray();
          },
        ),
      );
      console.log('allTabIds are:', allTabIds);
      allTabIds.forEach((tabId) => {
        sendChromeMessage({
          type: FullTextSearchMsg.AddToIndex,
          payload: { type: 'tab', id: tabId },
        });
      });
    },
  };
}
