/**

# TabSpace Registry

```
-----------------broadcast channel---------------------------
|   ^                        ^                              |
|   |                        |                              |
| tab(leader)                |------- tab(attendee) <-------|
|   ^                        |------- tab(attendee) <-------|
|---|                        |------- tab(attendee) <-------|
```

TabSpace Registry is a data structure shared and kept synced between our
TabSpace manager tabs. It is synced between TabSpace manager tabs through
broadcast channel. Among all TabSpace tabs, there is one as leader, and rest are
attendees.

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
import { TabSpaceRegistryChange, TabSpaceStub } from './TabSpaceRegistry';
import { logger } from '../../global';
import { isLeader, TabSpaceRegistryBroadcastMsg } from './state';
import {
  $tabSpaceRegistryState,
  retryIfStateNotReady,
  tabSpaceRegistryStateApi,
} from './store';

function onLeaderChange(
  leaderTabId: number,
  isThisTab: boolean,
  broadcastChannel: BroadcastChannel<TabSpaceRegistryBroadcastMsg>,
) {
  logger.log('leader changed to:', leaderTabId, isThisTab);
  chrome.tabs.getCurrent((tab) => {
    tabSpaceRegistryStateApi.setTabId(tab.id);
    tabSpaceRegistryStateApi.setLeaderTabId(leaderTabId);
    tabSpaceRegistryStateApi.setBroadcastChannel(broadcastChannel);
    if (isThisTab) {
      attendeeDestroy();
      leaderInit();
    } else {
      leaderDestroy();
      attendeeInit();
    }
    tabSpaceRegistryStateApi.setReady(true);
  });
}

export function bootstrap() {
  electionBootstrap(onLeaderChange);
}

export function addTabSpace(tabSpaceStud: TabSpaceStub) {
  retryIfStateNotReady(() => {
    if (isLeader($tabSpaceRegistryState.getState())) {
      logger.log('will addTabSpaceByLeader');
      addTabSpaceByLeader(tabSpaceStud);
    } else {
      logger.log('will addTabSpaceToLeader');
      addTabSpaceToLeader(tabSpaceStud);
    }
  });
}

export function removeTabSpace(chromeTabId: number) {
  retryIfStateNotReady(() => {
    if (isLeader($tabSpaceRegistryState.getState())) {
      logger.log('will removeTabSpaceByLeader', chromeTabId);
      removeTabSpaceByLeader(chromeTabId);
    }
  });
}

export function updateTabSpace(tabSpaceRegistryChange: TabSpaceRegistryChange) {
  retryIfStateNotReady(() => {
    if (isLeader($tabSpaceRegistryState.getState())) {
      logger.log('will updateTabSpaceByLeader', tabSpaceRegistryChange);
      updateTabSpaceByLeader(tabSpaceRegistryChange);
    } else {
      logger.log('will updateTabSpaceToLeader', tabSpaceRegistryChange);
      updateTabSpaceToLeader(tabSpaceRegistryChange);
    }
  });
}
