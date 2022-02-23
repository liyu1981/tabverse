import {
  BroadcastChannel,
  LeaderElector,
  createLeaderElection,
} from 'broadcast-channel';
import { hasOwnProperty, logger } from '../global';
import {
  InternServiceState,
  TabSpaceRegistryBroadcastMsg,
  TabSpaceRegistryBroadcastMsgType,
} from './common';

const BROADCAST_CHANNEL_NAME = 'tabspaceregistry_broadcast_channel';

type AttendeeCallback = (
  leaderTabId: number,
  isThisTab: boolean,
  broadcastChannel: BroadcastChannel<TabSpaceRegistryBroadcastMsg>,
) => void;

let _internState: InternServiceState | null = null;
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
        _internState !== null &&
        hasOwnProperty(_internState.broadcastChannelMessageHandlers, type)
      ) {
        _internState.getBroadcastChannelListener(type)(
          ev,
          _internState.broadcastChannel,
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
        _internState !== null &&
        hasOwnProperty(_internState.broadcastChannelMessageHandlers, type)
      ) {
        _internState.getBroadcastChannelListener(type)(
          ev,
          _internState.broadcastChannel,
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

async function getHandleDuplicate(
  internState: InternServiceState,
  callback: AttendeeCallback,
) {
  return async () => {
    logger.info(
      'duplicate leader found, will reset the channel and re elect leader.',
    );
    await _elector.die();
    await _channel.close();
    _internState.reset();
    bootstrap(internState, callback);
  };
}

export function bootstrap(
  internState: InternServiceState,
  callback: AttendeeCallback,
) {
  _internState = internState;
  _channel = new BroadcastChannel<TabSpaceRegistryBroadcastMsg>(
    BROADCAST_CHANNEL_NAME,
  );
  _elector = createLeaderElection(_channel);
  _elector.onduplicate = () => getHandleDuplicate(internState, callback);
  _elector.awaitLeadership().then(() => {
    postBootstrapAsLeader(callback);
  });
  postBootstrapAsAttendee(callback);
}
