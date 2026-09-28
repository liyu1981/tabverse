/**
 * Types shared between the extension client and the `tabversed` sync server.
 *
 * The wire contract lives in `api/openapi.yaml`; keep this file in sync with
 * it (the repo layer is deliberately dependency free so it can be unit tested
 * without chrome, IndexedDB or a bundler).
 */

export type EntityName =
  | 'tabspace'
  | 'tab'
  | 'note'
  | 'todo'
  | 'bookmark'
  // per tabspace ordered aggregates kept by the extension (id lists);
  // synced as records so ordering survives round trips
  | 'allnote'
  | 'alltodo'
  | 'allbookmark';

export const ENTITY_NAMES: EntityName[] = [
  'tabspace',
  'tab',
  'note',
  'todo',
  'bookmark',
  'allnote',
  'alltodo',
  'allbookmark',
];

export function isEntityName(value: string): value is EntityName {
  return (ENTITY_NAMES as string[]).indexOf(value) >= 0;
}

/** What the client sends during a sync push. */
export interface RecordInput {
  entity: EntityName;
  id: string;
  /** Client assigned modification time (unix ms), used for LWW. */
  updated_at: number;
  deleted?: boolean;
  /** JSON document of the entity. */
  payload: string;
}

/** What the server returns during a sync pull. */
export interface SyncRecord extends RecordInput {
  deleted: boolean;
  rev: number;
  server_at: number;
  device_id?: string;
}

export type RecordStatus = 'ok' | 'stale';

export interface RecordResult {
  entity: EntityName;
  id: string;
  status: RecordStatus;
  rev: number;
  updated_at: number;
  /** Present when status === 'stale': the winning server copy. */
  current?: SyncRecord;
}

export interface PushResult {
  results: RecordResult[];
  server_rev: number;
}

export interface PullResult {
  records: SyncRecord[];
  next_rev: number;
  has_more: boolean;
  server_rev: number;
}

export interface SearchHit {
  entity: EntityName;
  id: string;
  score: number;
  snippet?: string;
}

export interface DeviceCredentials {
  user_id: string;
  device_id: string;
  /** Shown exactly once; store it in chrome.storage, never in localStorage. */
  token: string;
  server_rev: number;
  issued_at?: number;
}

/** Persisted by the sync engine: the delta download cursor. */
export interface SyncState {
  last_rev: number;
  last_sync_at?: number;
}

export const EMPTY_SYNC_STATE: SyncState = { last_rev: 0 };
