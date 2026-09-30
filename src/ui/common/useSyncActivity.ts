/**
 * React binding for the "a sync is running" notice of data/repo/syncActivity:
 * true while any context (this page or the service worker) is syncing.
 */

import { useEffect, useState } from 'react';

import { isSyncing, subscribeSyncActivity } from '../../data/repo/syncActivity';

export function useSyncActivity(): boolean {
  const [syncing, setSyncing] = useState(() => isSyncing());
  useEffect(() => subscribeSyncActivity(setSyncing), []);
  return syncing;
}
