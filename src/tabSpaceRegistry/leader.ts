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
} from './common';

import {
  TabSpaceRegistryChange,
  TabSpaceRegistryJSON,
  TabSpaceStub,
} from './TabSpaceRegistry';
import { NotNeedPayload } from '../message/message';
import { getInternState } from './index';

function leaderOnMessageAddTabSpace(
  message: TabSpaceRegistryBroadcastMsg,
  channel: TabSpaceRegistryBroadcastChannel,
) {
  const { payload: tabSpaceStub } = message;
  getInternState().tabSpaceRegistry.add(tabSpaceStub);
  broadcast(getInternState().tabSpaceRegistry.toJSON());
}

function leaderOnMessageUpdateTabSpace(
  message: TabSpaceRegistryBroadcastMsg,
  channel: TabSpaceRegistryBroadcastChannel,
) {
  const { payload: tabSpaceRegistryChange } = message;
  getInternState().tabSpaceRegistry.mergeRegistryChanges([
    tabSpaceRegistryChange,
  ]);
  broadcast(getInternState().tabSpaceRegistry.toJSON());
}

export function init() {
  getInternState().setBroadcastChannelListener(
    TabSpaceRegistryBroadcastMsgType.AddTabSpace,
    leaderOnMessageAddTabSpace,
  );
  getInternState().setBroadcastChannelListener(
    TabSpaceRegistryBroadcastMsgType.UpdateTabSpace,
    leaderOnMessageUpdateTabSpace,
  );
  rollcall();
}

export function destroy() {
  if (getInternState() !== null) {
    getInternState().unsetBroadcastChannelListener(
      TabSpaceRegistryBroadcastMsgType.AddTabSpace,
    );
    getInternState().unsetBroadcastChannelListener(
      TabSpaceRegistryBroadcastMsgType.UpdateTabSpace,
    );
  }
}

async function broadcast(tabSpaceRegistryJSON: TabSpaceRegistryJSON) {
  if (getInternState() !== null) {
    console.log('will broadcast message:', {
      type: TabSpaceRegistryBroadcastMsgType.AnnounceTabSpaceRegistry,
      payload: tabSpaceRegistryJSON,
    });
    await getInternState().broadcastChannel.postMessage({
      type: TabSpaceRegistryBroadcastMsgType.AnnounceTabSpaceRegistry,
      payload: tabSpaceRegistryJSON,
    });
  }
}

async function rollcall() {
  if (getInternState() !== null) {
    await getInternState().broadcastChannel.postMessage({
      type: TabSpaceRegistryBroadcastMsgType.RollCall,
      payload: NotNeedPayload,
    });
  }
}

export async function removeTabSpaceByLeader(chromeTabId: number) {
  if (getInternState() !== null) {
    getInternState().tabSpaceRegistry.removeByChromeTabId(chromeTabId);
    broadcast(getInternState().tabSpaceRegistry.toJSON());
  }
}

export async function addTabSpaceByLeader(tabSpaceStub: TabSpaceStub) {
  if (getInternState() !== null) {
    getInternState().tabSpaceRegistry.add(tabSpaceStub);
    broadcast(getInternState().tabSpaceRegistry.toJSON());
  }
}

export async function updateTabSpaceByLeader(
  tabSpaceRegistryChange: TabSpaceRegistryChange,
) {
  if (getInternState() !== null) {
    getInternState().tabSpaceRegistry.mergeRegistryChanges([
      tabSpaceRegistryChange,
    ]);
    broadcast(getInternState().tabSpaceRegistry.toJSON());
  }
}
