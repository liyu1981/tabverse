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
  InternServiceState,
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

let _internState: InternServiceState | null = null;

function leaderOnMessageAddTabSpace(
  message: TabSpaceRegistryBroadcastMsg,
  channel: TabSpaceRegistryBroadcastChannel,
) {
  const { payload: tabSpaceStub } = message;
  _internState.tabSpaceRegistry.add(tabSpaceStub);
  broadcast(_internState.tabSpaceRegistry.toJSON());
}

function leaderOnMessageUpdateTabSpace(
  message: TabSpaceRegistryBroadcastMsg,
  channel: TabSpaceRegistryBroadcastChannel,
) {
  const { payload: tabSpaceRegistryChange } = message;
  _internState.tabSpaceRegistry.mergeRegistryChanges([tabSpaceRegistryChange]);
  broadcast(_internState.tabSpaceRegistry.toJSON());
}

export function init(interState: InternServiceState) {
  _internState = interState;
  _internState.setBroadcastChannelListener(
    TabSpaceRegistryBroadcastMsgType.AddTabSpace,
    leaderOnMessageAddTabSpace,
  );
  _internState.setBroadcastChannelListener(
    TabSpaceRegistryBroadcastMsgType.UpdateTabSpace,
    leaderOnMessageUpdateTabSpace,
  );
  rollcall();
}

export function destroy() {
  if (_internState !== null) {
    _internState.unsetBroadcastChannelListener(
      TabSpaceRegistryBroadcastMsgType.AddTabSpace,
    );
    _internState.unsetBroadcastChannelListener(
      TabSpaceRegistryBroadcastMsgType.UpdateTabSpace,
    );
  }
}

async function broadcast(tabSpaceRegistryJSON: TabSpaceRegistryJSON) {
  if (_internState !== null) {
    console.log('will broadcast message:', {
      type: TabSpaceRegistryBroadcastMsgType.AnnounceTabSpaceRegistry,
      payload: tabSpaceRegistryJSON,
    });
    await _internState.broadcastChannel.postMessage({
      type: TabSpaceRegistryBroadcastMsgType.AnnounceTabSpaceRegistry,
      payload: tabSpaceRegistryJSON,
    });
  }
}

async function rollcall() {
  if (_internState !== null) {
    await _internState.broadcastChannel.postMessage({
      type: TabSpaceRegistryBroadcastMsgType.RollCall,
      payload: NotNeedPayload,
    });
  }
}

export async function removeTabSpaceByLeader(chromeTabId: number) {
  if (_internState !== null) {
    _internState.tabSpaceRegistry.removeByChromeTabId(chromeTabId);
    broadcast(_internState.tabSpaceRegistry.toJSON());
  }
}

export async function addTabSpaceByLeader(tabSpaceStub: TabSpaceStub) {
  if (_internState !== null) {
    _internState.tabSpaceRegistry.add(tabSpaceStub);
    broadcast(_internState.tabSpaceRegistry.toJSON());
  }
}

export async function updateTabSpaceByLeader(
  tabSpaceRegistryChange: TabSpaceRegistryChange,
) {
  if (_internState !== null) {
    _internState.tabSpaceRegistry.mergeRegistryChanges([
      tabSpaceRegistryChange,
    ]);
    broadcast(_internState.tabSpaceRegistry.toJSON());
  }
}
