/**
 * The console's wire types, mirrored from `api/openapi.yaml` and from the Go
 * handlers that serve the console's own session endpoints
 * (`internal/api/console.go`, `internal/api/impersonate.go`).
 *
 * The console has no compiler of its own until adr/0018, so this file is where
 * the contract with the server is written down: a renamed field stops being a
 * runtime surprise here and becomes a type error. Nothing in it is
 * hand-converted from a Go struct beyond what is noted, and the timestamps are
 * the awkward part - see `IsoTime` and `Millis`.
 */

/** RFC3339, as the accounts and admin handlers marshal `time.Time`. */
export type IsoTime = string;

/** Unix milliseconds, as the record payloads and counters carry them. */
export type Millis = number;

export type Role = 'user' | 'admin';

/** The entities the server validates; the closed set the filters offer. */
export const ENTITIES = [
  'tabspace',
  'tab',
  'note',
  'todo',
  'bookmark',
  'closedtab',
  'allnote',
  'alltodo',
  'allbookmark',
] as const;

export type EntityName = (typeof ENTITIES)[number];

// ---- session ---------------------------------------------------------------

/** `GET /api/v1/admin/config`: the one unauthenticated admin route. */
export interface ServerConfig {
  admin_enabled: boolean;
  version?: string;
}

/** `GET /api/v1/console/me`: who the page is talking as, in every state. */
export interface Me {
  signed_in: boolean;
  user_id?: string;
  name?: string;
  email?: string;
  role?: Role;
  email_verified?: boolean;
  created_at?: IsoTime;
  csrf_header: string;
  /** Present only when signed in: the token to echo on writes. */
  csrf?: string;
  stats?: UserStats;
  devices?: DeviceInfo[];
  providers: string[];
  admin_email?: string;
  operator_exists?: boolean;
  /** Signed in, but nobody has claimed the operator role on this deployment. */
  awaiting_operator?: boolean;
}

/** `GET /api/v1/console/impersonation`: the read-only window, if any. */
export interface Impersonation {
  assuming: boolean;
  user_id?: string;
  as?: string;
  as_operator?: boolean;
  until?: IsoTime;
  read_only?: boolean;
}

// ---- accounts --------------------------------------------------------------

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: Role;
  created_at: IsoTime;
  rev_seq: number;
  device_count: number;
  token_count: number;
  revoked_token_count?: number;
  record_count: number;
  last_activity: Millis;
}

export interface UserList {
  users: UserSummary[];
}

export interface UserStats {
  user_id: string;
  rev_seq: number;
  total: number;
  live: number;
  by_entity: Record<string, number>;
}

export interface DeviceInfo {
  id: string;
  name: string;
  created_at: IsoTime;
  active_tokens: number;
  last_used: Millis;
  archived_at?: Millis;
  archived: boolean;
  /** Live records this device wrote that are archived (adr/0011). */
  archived_records: number;
}

export interface TokenInfo {
  hash: string;
  fingerprint: string;
  device_id: string;
  device_name?: string;
  created_at: IsoTime;
  revoked: boolean;
  last_used: Millis;
  archived_at?: Millis;
  archived: boolean;
}

export interface UserDetail {
  user: UserSummary;
  stats: UserStats;
  devices: DeviceInfo[];
  tokens: TokenInfo[];
}

export interface Invite {
  code: string;
  expires_at: IsoTime;
}

export interface ArchiveOutcome {
  archived: number;
  unarchived: number;
  skipped: number;
}

// ---- stored data -----------------------------------------------------------

export interface TabspaceSummary {
  id: string;
  name: string;
  created_at: Millis;
  updated_at: Millis;
  rev: number;
  tab_count: number;
  groups: number;
  notes: number;
  todos: number;
  bookmarks: number;
  closed_tabs: number;
}

/** One record of a tabverse, with its payload decoded. */
export interface BundleRow {
  id: string;
  rev: number;
  updated_at: Millis;
  server_at: Millis;
  /** Index in the client's own ordering (the tabverse's `tabIds`). */
  position: number;
  data: Record<string, any>;
}

export interface TabGroupHint {
  id: string;
  title: string;
  color: string;
  tabIds: string[];
}

export interface TabspaceBundle {
  tabspace: TabspaceSummary;
  /** The tabverse's own payload, decoded: the tab groups live here. */
  tabspace_data: Record<string, any>;
  tabs: BundleRow[];
  notes: BundleRow[];
  todos: BundleRow[];
  bookmarks: BundleRow[];
  closed_tabs: BundleRow[];
  /** The raw allnote / alltodo / allbookmark payloads: the display order. */
  aggregates: Record<string, string>;
}

export interface TabspacePage {
  tabspaces: TabspaceSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface RawRecord {
  entity: string;
  id: string;
  device_id?: string;
  rev: number;
  updated_at: Millis;
  server_at: Millis;
  deleted: boolean;
  archived_at?: Millis;
  payload: string;
}

export interface RecordPage {
  records: RawRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminSearchHit {
  entity: string;
  id: string;
  tabspace_id?: string;
  score: number;
  snippet?: string;
  title?: string;
  url?: string;
}

export interface AdminSearchResult {
  query?: string;
  hits: AdminSearchHit[];
}

export interface Totals {
  users: number;
  devices: number;
  active_tokens: number;
  live_records: number;
  tombstones: number;
  archived_devices?: number;
  archived_tokens?: number;
  archived_records?: number;
  by_entity?: Record<string, number>;
}
