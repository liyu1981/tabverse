/**

Read the connection structure in index.ts first.

Leader tab will be in charge of broadcasting tab space registry after change and
accept changes send by other attendees or itself.

1. broadcast: after tab space registry changed, the whole tab space registry
   will be broadcasted through out broadcast channel.

2. accept changes: when a tab space is created, the changes will be sent by
   attendee tab through broadcasting; when a tab space is deleted, the changes
   will be collected by leader tab through chrome.tabs.onRemove.

3. roll call: after a tab space became leader, it will broadcast roll call to
   all attendees to recollect available tabSpaces.

*/

import {
  TabSpaceRegistryBroadcastChannel,
  TabSpaceRegistryBroadcastMsg,
  TabSpaceRegistryBroadcastMsgType,
} from './state';

import {
  TabSpaceRegistryChange,
  TabSpaceRegistryInArray,
  TabSpaceStub,
  toTabSpaceRegistryInArray,
} from './TabSpaceRegistry';
import { NotNeedPayload } from '../../message/message';
import { logger } from '../../global';
import {
  $tabSpaceRegistryState,
  getStateTabSpaceRegistry,
  mergeTabRegistryChanges,
  tabSpaceRegistryStateApi,
} from './store';

function leaderOnMessageAddTabSpace(
  message: TabSpaceRegistryBroadcastMsg,
  channel: TabSpaceRegistryBroadcastChannel,
) {
  const { payload: tabSpaceStub } = message;
  tabSpaceRegistryStateApi.addTabSpaceStub(tabSpaceStub);
  broadcast(toTabSpaceRegistryInArray(getStateTabSpaceRegistry()));
}

function leaderOnMessageUpdateTabSpace(
  message: TabSpaceRegistryBroadcastMsg,
  channel: TabSpaceRegistryBroadcastChannel,
) {
  const { payload: tabSpaceRegistryChanges } = message;
  mergeTabRegistryChanges(tabSpaceRegistryChanges);
  broadcast(toTabSpaceRegistryInArray(getStateTabSpaceRegistry()));
}

export function init() {
  tabSpaceRegistryStateApi.setBroadcastChannelListener({
    type: TabSpaceRegistryBroadcastMsgType.AddTabSpace,
    handler: leaderOnMessageAddTabSpace,
  });
  tabSpaceRegistryStateApi.setBroadcastChannelListener({
    type: TabSpaceRegistryBroadcastMsgType.UpdateTabSpace,
    handler: leaderOnMessageUpdateTabSpace,
  });
  rollcall();
}

export function destroy() {
  tabSpaceRegistryStateApi.unsetBroadcastChannelListener(
    TabSpaceRegistryBroadcastMsgType.AddTabSpace,
  );
  tabSpaceRegistryStateApi.unsetBroadcastChannelListener(
    TabSpaceRegistryBroadcastMsgType.UpdateTabSpace,
  );
}

async function broadcast(tabSpaceRegistryJSON: TabSpaceRegistryInArray) {
  logger.log('will broadcast message:', {
    type: TabSpaceRegistryBroadcastMsgType.AnnounceTabSpaceRegistry,
    payload: tabSpaceRegistryJSON,
  });
  await $tabSpaceRegistryState.getState().broadcastChannel.postMessage({
    type: TabSpaceRegistryBroadcastMsgType.AnnounceTabSpaceRegistry,
    payload: tabSpaceRegistryJSON,
  });
}

async function rollcall() {
  await $tabSpaceRegistryState.getState().broadcastChannel.postMessage({
    type: TabSpaceRegistryBroadcastMsgType.RollCall,
    payload: NotNeedPayload,
  });
}

export async function removeTabSpaceByLeader(chromeTabId: number) {
  tabSpaceRegistryStateApi.removeTabSpaceByChromeTabId(chromeTabId);
  broadcast(toTabSpaceRegistryInArray(getStateTabSpaceRegistry()));
}

export async function addTabSpaceByLeader(tabSpaceStub: TabSpaceStub) {
  tabSpaceRegistryStateApi.addTabSpaceStub(tabSpaceStub);
  broadcast(toTabSpaceRegistryInArray(getStateTabSpaceRegistry()));
}

export async function updateTabSpaceByLeader(
  tabSpaceRegistryChange: TabSpaceRegistryChange,
) {
  mergeTabRegistryChanges([tabSpaceRegistryChange]);
  broadcast(toTabSpaceRegistryInArray(getStateTabSpaceRegistry()));
}
