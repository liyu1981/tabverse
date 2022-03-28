import { createApi, createStore } from 'effector';
import { exposeDebugData } from '../../debug';
import { LoadStatus } from '../../global';
import { setAttrForObject } from '../common';
import { newEmptySavedChromeSessionCollection } from './SavedChromeSessionCollection';
import { loadSavedSessionsForDisplay, SavedSessionGroup } from './sessionStore';

export const $savedChromeSessionCollection = createStore(
  newEmptySavedChromeSessionCollection(),
);

export const savedChromeSessionCollectionApi = createApi(
  $savedChromeSessionCollection,
  {
    setSavedSessionGroups: (
      lastSavedChromeSessionCollection,
      newSavedSessionGroups: SavedSessionGroup[],
    ) =>
      setAttrForObject(
        'savedSessionGroups',
        newSavedSessionGroups,
        lastSavedChromeSessionCollection,
      ),
    setLoadStatus: (lastSavedChromeSessionCollection, loadStatus: LoadStatus) =>
      setAttrForObject(
        'loadStatus',
        loadStatus,
        lastSavedChromeSessionCollection,
      ),
  },
);

export async function reloadSavedChromeSessionCollection() {
  savedChromeSessionCollectionApi.setSavedSessionGroups([]);
  savedChromeSessionCollectionApi.setLoadStatus(LoadStatus.Loading);
  savedChromeSessionCollectionApi.setSavedSessionGroups(
    await loadSavedSessionsForDisplay(),
  );
  savedChromeSessionCollectionApi.setLoadStatus(LoadStatus.Done);
}

exposeDebugData('chromeSession', {
  $savedChromeSessionCollection,
});
