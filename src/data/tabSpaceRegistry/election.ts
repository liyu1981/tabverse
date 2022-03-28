import {
  BroadcastChannel,
  LeaderElector,
  createLeaderElection,
} from 'broadcast-channel';
import { hasOwnProperty, logger } from '../../global';
import {
  getBroadcastChannelListener,
  TabSpaceRegistryBroadcastMsg,
  TabSpaceRegistryBroadcastMsgType,
} from './state';
import { $tabSpaceRegistryState, tabSpaceRegistryStateApi } from './store';

const BROADCAST_CHANNEL_NAME = 'tabspaceregistry_broadcast_channel';

type AttendeeCallback = (
  leaderTabId: number,
  isThisTab: boolean,
  broadcastChannel: BroadcastChannel<TabSpaceRegistryBroadcastMsg>,
) => void;

let _channel: BroadcastChannel<TabSpaceRegistryBroadcastMsg> | null = null;
let _elector: LeaderElector | null = null;

function getLeaderOnMessage(leaderTabId: number) {
  function leaderOnMessage(
    this: BroadcastChannel<any>,
    ev: TabSpaceRegistryBroadcastMsg,
  ) {
    const { type } = ev;
    logger.log('leader recv msg:', ev);
    if (type === TabSpaceRegistryBroadcastMsgType.QueryForLeader) {
      _channel.postMessage({
        type: TabSpaceRegistryBroadcastMsgType.AnnounceLeader,
        payload: leaderTabId,
      });
    } else {
      if (
        hasOwnProperty(
          $tabSpaceRegistryState.getState().broadcastChannelMessageHandlers,
          type,
        )
      ) {
        getBroadcastChannelListener(type, $tabSpaceRegistryState.getState())(
          ev,
          $tabSpaceRegistryState.getState().broadcastChannel,
        );
      } else {
        logger.error(
          `leaderOnMessage does not know how to handle message: ${ev}`,
        );
      }
    }
  }
  return leaderOnMessage;
}

async function postBootstrapAsLeader(callback: AttendeeCallback) {
  const tab = await chrome.tabs.getCurrent();
  _channel.onmessage = getLeaderOnMessage(tab.id);
  callback(tab.id, true, _channel);
}

function getAttendeeOnMessage(callback: AttendeeCallback) {
  function attendeeOnMessage(
    this: BroadcastChannel<any>,
    ev: TabSpaceRegistryBroadcastMsg,
  ) {
    const { type, payload } = ev;
    if (type === TabSpaceRegistryBroadcastMsgType.AnnounceLeader) {
      callback(payload, false, _channel);
    } else {
      if (
        hasOwnProperty(
          $tabSpaceRegistryState.getState().broadcastChannelMessageHandlers,
          type,
        )
      ) {
        getBroadcastChannelListener(type, $tabSpaceRegistryState.getState())(
          ev,
          $tabSpaceRegistryState.getState().broadcastChannel,
        );
      } else {
        logger.error(
          `attendeeOnMessage does not know how to handle message: ${ev}`,
        );
      }
    }
  }
  return attendeeOnMessage;
}

function attendeeQueryForLeader() {
  const timeout = 500;
  let retry = 0;
  const maxRetry = 10;
  const f = () => {
    if (_elector.hasLeader) {
      _channel.postMessage({
        type: TabSpaceRegistryBroadcastMsgType.QueryForLeader,
        payload: null,
      });
    } else {
      if (retry < maxRetry) {
        retry += 1;
        setTimeout(f, timeout);
      }
    }
  };
  f();
}

async function postBootstrapAsAttendee(callback: AttendeeCallback) {
  _channel.onmessage = getAttendeeOnMessage(callback);
  attendeeQueryForLeader();
}

async function getHandleDuplicate(callback: AttendeeCallback) {
  return async () => {
    logger.info(
      'duplicate leader found, will reset the channel and re elect leader.',
    );
    await _elector.die();
    await _channel.close();
    tabSpaceRegistryStateApi.reset();
    bootstrap(callback);
  };
}

export function bootstrap(callback: AttendeeCallback) {
  _channel = new BroadcastChannel<TabSpaceRegistryBroadcastMsg>(
    BROADCAST_CHANNEL_NAME,
  );
  _elector = createLeaderElection(_channel);
  _elector.onduplicate = () => getHandleDuplicate(callback);
  _elector.awaitLeadership().then(() => {
    postBootstrapAsLeader(callback);
  });
  postBootstrapAsAttendee(callback);
}
