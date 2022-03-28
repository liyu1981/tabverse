/**

Read the connection structure in index.ts first.

Attendee tab will be responsible to report itself to leader, and update the
local tabSpace registry when leader announce the new version.

1. report itself: after this tab space is loaded, report itself to leader, or
   after got roll call broadcast from leader, report itself again.

2. update local registry: when get the announce broadcast msg from leader,
   update local copy of tabSpace registry.

*/

import {
  fromTabSpaceRegistryInArray,
  TabSpaceRegistryChange,
  TabSpaceStub,
} from './TabSpaceRegistry';
import {
  TabSpaceRegistryBroadcastChannel,
  TabSpaceRegistryBroadcastMsg,
  TabSpaceRegistryBroadcastMsgType,
} from './state';
import { $tabSpace } from '../tabSpace/store';
import { toTabSpaceStub } from '../tabSpace/TabSpace';
import { $tabSpaceRegistryState, tabSpaceRegistryStateApi } from './store';

function attendeeOnBroadcastAnnounceTabSpaceRegistry(
  message: TabSpaceRegistryBroadcastMsg,
  channel: TabSpaceRegistryBroadcastChannel,
) {
  const { payload } = message;
  tabSpaceRegistryStateApi.updateTabSpaceRegistry(
    fromTabSpaceRegistryInArray(payload),
  );
}

function attendeeOnBroadcastRollCall(
  message: TabSpaceRegistryBroadcastMsg,
  channel: TabSpaceRegistryBroadcastChannel,
) {
  addTabSpaceToLeader(toTabSpaceStub($tabSpace.getState()));
}

export function init() {
  tabSpaceRegistryStateApi.setBroadcastChannelListener({
    type: TabSpaceRegistryBroadcastMsgType.AnnounceTabSpaceRegistry,
    handler: attendeeOnBroadcastAnnounceTabSpaceRegistry,
  });
  tabSpaceRegistryStateApi.setBroadcastChannelListener({
    type: TabSpaceRegistryBroadcastMsgType.RollCall,
    handler: attendeeOnBroadcastRollCall,
  });
}

export function destroy() {
  tabSpaceRegistryStateApi.unsetBroadcastChannelListener(
    TabSpaceRegistryBroadcastMsgType.AnnounceTabSpaceRegistry,
  );
  tabSpaceRegistryStateApi.unsetBroadcastChannelListener(
    TabSpaceRegistryBroadcastMsgType.RollCall,
  );
}

export function addTabSpaceToLeader(tabSpaceStub: TabSpaceStub) {
  $tabSpaceRegistryState.getState().broadcastChannel.postMessage({
    type: TabSpaceRegistryBroadcastMsgType.AddTabSpace,
    payload: tabSpaceStub,
  });
}

export function updateTabSpaceToLeader(
  tabSpaceRegistryChange: TabSpaceRegistryChange,
) {
  $tabSpaceRegistryState.getState().broadcastChannel.postMessage({
    type: TabSpaceRegistryBroadcastMsgType.UpdateTabSpace,
    payload: tabSpaceRegistryChange,
  });
}
