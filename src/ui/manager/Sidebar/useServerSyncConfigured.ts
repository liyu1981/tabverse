import { useEffect, useState } from 'react';

import { loadSyncConfig } from '../../../data/repo/syncConfig';
import {
  SyncMsg,
  subscribePubSubMessage,
  unsubscribePubSubMessage,
} from '../../../message/message';

/**
 * Whether this device is paired with a server, re-read when the setting flips
 * (the sync dialog publishes `SyncMsg.ConfigChanged`). The omni search is only
 * worth offering when there is a server to search.
 */
export function useServerSyncConfigured(): boolean {
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    let alive = true;
    const reload = () => {
      loadSyncConfig()
        .then((config) => {
          if (alive) setConfigured(Boolean(config?.enabled));
        })
        .catch(() => {
          if (alive) setConfigured(false);
        });
    };
    reload();
    const token = subscribePubSubMessage(SyncMsg.ConfigChanged, reload);
    return () => {
      alive = false;
      unsubscribePubSubMessage(token);
    };
  }, []);

  return configured;
}
