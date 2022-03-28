import { createApi, createStore } from 'effector';
import {
  addTabSpaceStub,
  mergeRegistryChanges,
  removeTabSpaceByChromeTabId,
  removeTabSpaceStub,
  TabSpaceRegistry,
  TabSpaceRegistryChange,
  TabSpaceStub,
} from './TabSpaceRegistry';
import {
  BroadcastChannelMessageHandler,
  newEmptyTabSpaceRegistryState,
  setBroadcastChannelListener,
  TabSpaceRegistryBroadcastChannel,
  unsetBroadcastChannelListener,
} from './state';
import { setAttrForObject } from '../common';
import { exposeDebugData } from '../../debug';

export const $tabSpaceRegistryState = createStore(
  newEmptyTabSpaceRegistryState(),
);

export function getStateTabSpaceRegistry(): TabSpaceRegistry {
  return $tabSpaceRegistryState.getState().tabSpaceRegistry;
}

export const tabSpaceRegistryStateApi = createApi($tabSpaceRegistryState, {
  reset: (lastState) => newEmptyTabSpaceRegistryState(),
  updateTabSpaceRegistry: (
    lastState,
    updatedTabSpaceRegistry: TabSpaceRegistry,
  ) => setAttrForObject('tabSpaceRegistry', updatedTabSpaceRegistry, lastState),
  addTabSpaceStub: (lateState, tabSpaceStub: TabSpaceStub) =>
    setAttrForObject(
      'tabSpaceRegistry',
      addTabSpaceStub(tabSpaceStub, lateState.tabSpaceRegistry),
      lateState,
    ),
  removeTabSpaceStub: (lastState, tabSpaceId: string) =>
    setAttrForObject(
      'tabSpaceRegistry',
      removeTabSpaceStub(tabSpaceId, lastState.tabSpaceRegistry),
      lastState,
    ),
  removeTabSpaceByChromeTabId: (lastState, chromeTabId: number) =>
    setAttrForObject(
      'tabSpaceRegistry',
      removeTabSpaceByChromeTabId(chromeTabId, lastState.tabSpaceRegistry),
      lastState,
    ),
  setBroadcastChannelListener: (
    lastState,
    {
      type,
      handler,
    }: { type: string; handler: BroadcastChannelMessageHandler },
  ) => setBroadcastChannelListener(type, handler, lastState),
  unsetBroadcastChannelListener: (lastState, type: string) =>
    unsetBroadcastChannelListener(type, lastState),
  setTabId: (lastState, tabId: number) =>
    setAttrForObject('tabId', tabId, lastState),
  setLeaderTabId: (lastState, leaderTabId: number) =>
    setAttrForObject('leaderTabId', leaderTabId, lastState),
  setBroadcastChannel: (
    lastState,
    broadcastChannel: TabSpaceRegistryBroadcastChannel,
  ) => setAttrForObject('broadcastChannel', broadcastChannel, lastState),
  setReady: (lastState, ready: boolean) =>
    setAttrForObject('ready', ready, lastState),
});

export function mergeTabRegistryChanges(changes: TabSpaceRegistryChange[]) {
  const { tabSpaceRegistry: newTabSpaceRegistry, changed } =
    mergeRegistryChanges(changes, getStateTabSpaceRegistry());
  tabSpaceRegistryStateApi.updateTabSpaceRegistry(newTabSpaceRegistry);
  return changed;
}

export function retryIfStateNotReady(
  userAction: () => void | Promise<void>,
  maxRetry = 5,
  waitInterval = 500,
) {
  let retryCount = 0;
  function action() {
    if ($tabSpaceRegistryState.getState().ready) {
      userAction();
    } else {
      if (retryCount < maxRetry) {
        retryCount += 1;
        setTimeout(action, waitInterval);
      }
    }
  }
  action();
}

exposeDebugData('tabSpaceRegistry', {
  store: $tabSpaceRegistryState,
});
