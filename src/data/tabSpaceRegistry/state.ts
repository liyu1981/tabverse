import { TabSpaceRegistry, newEmptyTabSpaceRegistry } from './TabSpaceRegistry';

import { BroadcastChannel } from 'broadcast-channel';
import { Map } from 'immutable';

export enum TabSpaceRegistryBroadcastMsgType {
  QueryForLeader = 'tsrb_queryforleader',
  AnnounceLeader = 'tsrb_annouceleader',
  AnnounceTabSpaceRegistry = 'tsrb_annoucetabspaceregistry',
  RollCall = 'tsrb_rollcall',
  AddTabSpace = 'tsrb_addtabspace',
  UpdateTabSpace = 'tsrb_updatetabspace',
}

export type TabSpaceRegistryBroadcastMsg = {
  type: TabSpaceRegistryBroadcastMsgType;
  payload: any;
};

export type TabSpaceRegistryBroadcastChannel =
  BroadcastChannel<TabSpaceRegistryBroadcastMsg>;

export type BroadcastChannelMessageHandler = (
  message: TabSpaceRegistryBroadcastMsg,
  channel: TabSpaceRegistryBroadcastChannel,
) => void | Promise<void>;

export type TabSpaceRegistryState = {
  tabId: number | null;
  leaderTabId: number | null;
  broadcastChannel: TabSpaceRegistryBroadcastChannel | null;
  broadcastChannelMessageHandlers: Map<string, BroadcastChannelMessageHandler>;
  tabSpaceRegistry: TabSpaceRegistry;
  ready: boolean;
};

export function newEmptyTabSpaceRegistryState(): TabSpaceRegistryState {
  return {
    tabId: null,
    leaderTabId: null,
    broadcastChannel: null,
    broadcastChannelMessageHandlers: Map(),
    tabSpaceRegistry: newEmptyTabSpaceRegistry(),
    ready: false,
  };
}

export function setBroadcastChannelListener(
  type: string,
  handler: BroadcastChannelMessageHandler,
  targetTabSpaceRegistryState: TabSpaceRegistryState,
): TabSpaceRegistryState {
  return {
    ...targetTabSpaceRegistryState,
    broadcastChannelMessageHandlers:
      targetTabSpaceRegistryState.broadcastChannelMessageHandlers.set(
        type,
        handler,
      ),
  };
}

export function unsetBroadcastChannelListener(
  type: string,
  targetTabSpaceRegistryState: TabSpaceRegistryState,
): TabSpaceRegistryState {
  return {
    ...targetTabSpaceRegistryState,
    broadcastChannelMessageHandlers:
      targetTabSpaceRegistryState.broadcastChannelMessageHandlers.remove(type),
  };
}

export function getBroadcastChannelListener(
  type: string,
  targetTabSpaceRegistryState: TabSpaceRegistryState,
): BroadcastChannelMessageHandler {
  return targetTabSpaceRegistryState.broadcastChannelMessageHandlers.get(type);
}

export function isLeader(
  targetTabSpaceRegistryState: TabSpaceRegistryState,
): boolean {
  return (
    targetTabSpaceRegistryState.leaderTabId !== null &&
    targetTabSpaceRegistryState.tabId ===
      targetTabSpaceRegistryState.leaderTabId
  );
}
