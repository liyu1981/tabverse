/**

# TabSpace Registry Service

```
-----------------broadcast channel---------------------------
|   ^                        ^                              |
|   |                        |                              |
| tab(leader)                |------- tab(attendee) <-------|
|   ^                        |------- tab(attendee) <-------|
|---|                        |------- tab(attendee) <-------|
```

TabSpace Registry is a data structure kept synced between our TabSpace tabs. It
is synced between TabSpace tabs through broadcast channel. Among all TabSpace
tabs, there is one as leader, and rest are attendees.

1. There is a tab acting as leader, who is elected shortly after TabSpace
   Registry Service is bootstrapped.

2. Other than tab leader are tab attendees. It can become leader through call
   provided to bootstrap function.

With above connection structure, we should be able to

1. sync tabspace registry structure easily, as we only need the leader to
   broadcast the updated tabspace registry after it is updated whenever.

2. change tabspace registry structure easily. And TabSpace change
   (create/destroy) can be sent (in fact, broadcast) to leader, then leader
   broadcasts the registry to all attendees.

*/

import {
  InternServiceState,
  retryIfStateNotReady,
  TabSpaceRegistryBroadcastMsg,
} from './common';
import {
  addTabSpaceToLeader,
  destroy as attendeeDestroy,
  init as attendeeInit,
  updateTabSpaceToLeader,
} from './attendee';
import {
  addTabSpaceByLeader,
  destroy as leaderDestroy,
  init as leaderInit,
  removeTabSpaceByLeader,
  updateTabSpaceByLeader,
} from './leader';

import { BroadcastChannel } from 'broadcast-channel';
import { bootstrap as electionBootstrap } from './election';
import {
  TabSpaceRegistryChange,
  TabSpaceStub,
} from '../../data/tabSpace/TabSpaceRegistry';
import { exposeDebugData } from '../../debug';

export const _state = new InternServiceState();

function onLeaderChange(
  leaderTabId: number,
  isThisTab: boolean,
  broadcastChannel: BroadcastChannel<TabSpaceRegistryBroadcastMsg>,
) {
  console.log('leader changed to:', leaderTabId, isThisTab);
  chrome.tabs.getCurrent((tab) => {
    _state.setTabId(tab.id);
    _state.setLeaderTabId(leaderTabId);
    _state.setBroadcastChannel(broadcastChannel);
    if (isThisTab) {
      attendeeDestroy();
      leaderInit(_state);
    } else {
      leaderDestroy();
      attendeeInit(_state);
    }
    _state.setReady(true);
  });
}

export function bootstrap() {
  electionBootstrap(_state, onLeaderChange);

  exposeDebugData('service', {
    getTabSpaceRegistry: () => {
      return _state;
    },
  });
}

export function getTabSpaceRegistry() {
  return _state.tabSpaceRegistry;
}

export function addTabSpace(tabSpaceStud: TabSpaceStub) {
  retryIfStateNotReady(_state, () => {
    if (_state.isLeader()) {
      console.log('will addTabSpaceByLeader');
      addTabSpaceByLeader(tabSpaceStud);
    } else {
      console.log('will addTabSpaceToLeader');
      addTabSpaceToLeader(tabSpaceStud);
    }
  });
}

export function removeTabSpace(chromeTabId: number) {
  retryIfStateNotReady(_state, () => {
    if (_state.isLeader()) {
      console.log('will removeTabSpaceByLeader', chromeTabId);
      removeTabSpaceByLeader(chromeTabId);
    }
  });
}

export function updateTabSpace(tabSpaceRegistryChange: TabSpaceRegistryChange) {
  retryIfStateNotReady(_state, () => {
    if (_state.isLeader()) {
      console.log('will updateTabSpaceByLeader', tabSpaceRegistryChange);
      updateTabSpaceByLeader(tabSpaceRegistryChange);
    } else {
      console.log('will updateTabSpaceToLeader', tabSpaceRegistryChange);
      updateTabSpaceToLeader(tabSpaceRegistryChange);
    }
  });
}
