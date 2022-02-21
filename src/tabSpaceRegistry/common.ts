import { BroadcastChannel } from 'broadcast-channel';
import { TabSpaceRegistry } from './TabSpaceRegistry';

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

export class InternServiceState {
  tabId: number | null;
  leaderTabId: number | null;
  broadcastChannel: TabSpaceRegistryBroadcastChannel | null;
  broadcastChannelMessageHandlers: {
    [k: string]: BroadcastChannelMessageHandler;
  };
  tabSpaceRegistry: TabSpaceRegistry;
  ready: boolean;

  constructor() {
    this.reset();
  }

  reset() {
    this.tabId = null;
    this.leaderTabId = null;
    this.broadcastChannel = null;
    this.broadcastChannelMessageHandlers = {};
    this.tabSpaceRegistry = new TabSpaceRegistry();
    this.ready = false;
  }

  setTabId(id: number) {
    this.tabId = id;
  }

  setLeaderTabId(id: number) {
    this.leaderTabId = id;
  }

  setBroadcastChannel(channel: TabSpaceRegistryBroadcastChannel) {
    this.broadcastChannel = channel;
  }

  setBroadcastChannelListener(
    type: string,
    handler: BroadcastChannelMessageHandler,
  ) {
    this.broadcastChannelMessageHandlers[type] = handler;
  }

  unsetBroadcastChannelListener(type: string) {
    delete this.broadcastChannelMessageHandlers[type];
  }

  getBroadcastChannelListener(type: string) {
    return this.broadcastChannelMessageHandlers[type];
  }

  isLeader(): boolean {
    return this.leaderTabId !== null && this.tabId === this.leaderTabId;
  }

  setReady(value: boolean) {
    this.ready = value;
  }
}

export function retryIfStateNotReady(
  state: InternServiceState,
  userAction: () => void | Promise<void>,
  maxRetry = 5,
  waitInterval = 500,
) {
  let retryCount = 0;
  function action() {
    if (state !== null && state.ready) {
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
