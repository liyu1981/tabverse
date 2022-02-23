/**

Read the connection structure in index.ts first.

Attendee tab will be responsible to report itself to leader, and update the
local tabSpace registry when leader announce the new version.

1. report itself: after this tab space is loaded, report itself to leader, or
   after got roll call broadcast from leader, report itself again.

2. update local registry: when get the announce broadcast msg from leader,
   update local copy of tabSpace registry.

*/

import { getTabSpaceData } from '../data/tabSpace/bootstrap';
import { TabSpaceRegistryChange, TabSpaceStub } from './TabSpaceRegistry';
import {
  InternServiceState,
  TabSpaceRegistryBroadcastChannel,
  TabSpaceRegistryBroadcastMsg,
  TabSpaceRegistryBroadcastMsgType,
} from './common';

let _internState: InternServiceState | null = null;

function attendeeOnBroadcastAnnounceTabSpaceRegistry(
  message: TabSpaceRegistryBroadcastMsg,
  channel: TabSpaceRegistryBroadcastChannel,
) {
  const { payload } = message;
  if (_internState !== null) {
    _internState.tabSpaceRegistry.replaceFromJSON(payload);
  }
}

function attendeeOnBroadcastRollCall(
  message: TabSpaceRegistryBroadcastMsg,
  channel: TabSpaceRegistryBroadcastChannel,
) {
  addTabSpaceToLeader(getTabSpaceData().tabSpace.toTabSpaceStub());
}

export function init(internState: InternServiceState) {
  _internState = internState;
  _internState.setBroadcastChannelListener(
    TabSpaceRegistryBroadcastMsgType.AnnounceTabSpaceRegistry,
    attendeeOnBroadcastAnnounceTabSpaceRegistry,
  );
  _internState.setBroadcastChannelListener(
    TabSpaceRegistryBroadcastMsgType.RollCall,
    attendeeOnBroadcastRollCall,
  );
}

export function destroy() {
  if (_internState !== null) {
    _internState.unsetBroadcastChannelListener(
      TabSpaceRegistryBroadcastMsgType.AnnounceTabSpaceRegistry,
    );
    _internState.unsetBroadcastChannelListener(
      TabSpaceRegistryBroadcastMsgType.RollCall,
    );
  }
}

export function addTabSpaceToLeader(tabSpaceStub: TabSpaceStub) {
  if (_internState !== null) {
    _internState.broadcastChannel.postMessage({
      type: TabSpaceRegistryBroadcastMsgType.AddTabSpace,
      payload: tabSpaceStub,
    });
  }
}

export function updateTabSpaceToLeader(
  tabSpaceRegistryChange: TabSpaceRegistryChange,
) {
  if (_internState !== null) {
    _internState.broadcastChannel.postMessage({
      type: TabSpaceRegistryBroadcastMsgType.UpdateTabSpace,
      payload: tabSpaceRegistryChange,
    });
  }
}
