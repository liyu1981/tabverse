/**
 * Server sync layer for the Tabverse extension.
 *
 * Layering (all dependencies point downwards, no chrome/IndexedDB imports at
 * the top so everything is unit testable):
 *
 *   SyncEngine (repo.ts)   - orchestration: push outbox, pull delta, cursor
 *     -> ServerApiClient   - typed HTTP/WS client for `tabversed`
 *     -> Outbox            - durable mutation queue (chrome.storage.local)
 *     -> SyncStateStore    - persisted revision cursor
 *   RealtimeClient         - WebSocket with reconnect, triggers delta pulls
 *   dbBridge               - entity <-> Dexie table mapping (list/apply)
 *   changeFeed             - Dexie write hooks -> outbox
 *   backgroundSync         - service worker wiring of all of the above
 */

export * from './types';
export * from './serverApi';
export * from './outbox';
export * from './repo';
export * from './realtime';
export * from './syncConfig';
export * from './localTables';
export * from './dbBridge';
export * from './changeFeed';
export * from './backgroundSync';
