import { TabSpaceDatabase } from './TabSpaceDatabase';

// The database handle. Change observation lives in data/repo/changeFeed.ts,
// which hooks Dexie's own write hooks - no addon, no BroadcastChannel.
export const dbImpl = new TabSpaceDatabase();
