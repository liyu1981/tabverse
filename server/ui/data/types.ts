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
type IsoTime = string;

/** Unix milliseconds, as the record payloads and counters carry them. */
type Millis = number;

type Role = 'user' | 'admin';

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

// ---- session ---------------------------------------------------------------

/** `GET /console/api/v1/admin/config`: the one unauthenticated admin route. */
export interface ServerConfig {
  admin_enabled: boolean;
  version?: string;
}

/** `GET /console/api/v1/console/me`: who the page is talking as, in every state. */
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
  /**
   * Whether the server can post the sign-in link at all. With no SMTP host the
   * sender logs the link instead, and the sign-in view says so rather than
   * leaving somebody to wait for an email that was never sent.
   */
  smtp?: boolean;
  /**
   * Whether the passwordless email path is offered at all. Off on the official
   * flavour, where the console shows only the social buttons.
   */
  email_registration?: boolean;
  /**
   * Which transport the server would use to send mail: `'resend'`, `'smtp'`, or
   * `''` when neither is configured (messages are logged). The console labels
   * its send button from it and disables sending when it is empty.
   */
  mail_transport?: 'resend' | 'smtp' | '';
  /**
   * Whether there is a site at `/` worth going back to: this build carries the
   * documentation rather than only the redirect page (adr/0024). The top bar
   * offers the link on this answer alone, because in a build without the docs
   * `/` is a page whose whole job is to send you straight back here.
   */
  docs?: boolean;
  admin_email?: string;
  operator_exists?: boolean;
  /** Signed in, but nobody has claimed the operator role on this deployment. */
  awaiting_operator?: boolean;
  /**
   * Signed in, but the account came from a login with no invitation yet on an
   * invite-only server: the console shows the "request received" notice
   * instead of the account.
   */
  pending_registration?: boolean;
  /**
   * Authenticated with a provider, but no account exists for the subject yet:
   * registration is a separate step now (adr/0029), so the console shows the
   * register page. `registration` carries what the provider supplied.
   */
  needs_registration?: boolean;
  registration?: PendingRegistration;
  /**
   * Whether new accounts need an operator's invitation on this server
   * (`TABVERSED_REGISTRATION_REQUIRES_INVITE`). The register page then asks for
   * the code and offers to request one.
   */
  invite_required?: boolean;
  /**
   * Whether the membership system is on at all (adr/0032). Off means every
   * account is unlimited and none of the membership controls appear.
   */
  membership_enabled?: boolean;
  /** The signed-in account's lease and credits, when the system is on. */
  membership?: MembershipView;
}

// ---- membership (adr/0032) -------------------------------------------------

/**
 * A lease computed from `expires_at`, never stored: `active` while the lease is
 * good, `expired` during the retention window (read-only console), `closable`
 * once it has passed, and `unlimited` when no lease applies.
 */
export type MembershipStatus = 'unlimited' | 'active' | 'expired' | 'closable';

export interface MembershipView {
  enabled: boolean;
  status: MembershipStatus;
  /** The account may look and download, but not write. */
  read_only: boolean;
  unlimited: boolean;
  /** Unix ms; 0 when the lease was never opened. */
  expires_at: Millis;
  credits: number;
  period_days: number;
  period_credits: number;
  retention_days: number;
  /** Unix ms the account would be closed at, 0 when it does not apply. */
  retention_until: Millis;
  days_left: number;
  /** Days until the account closes, during the expired window. */
  days_until_close: number;
  can_export: boolean;
}

/** One append-only movement of credits. */
export interface MembershipLedgerEntry {
  id: number;
  user_id: string;
  delta: number;
  balance: number;
  reason: string;
  actor_user_id?: string;
  at: Millis;
  detail?: string;
}

/** A directory row: the account plus its lease and balance. */
export interface MembershipSummary {
  user_id: string;
  name: string;
  email: string;
  role: Role;
  expires_at: Millis;
  credits: number;
  unlimited: boolean;
  trial_granted_at: Millis;
  expired_at: Millis;
  status: MembershipStatus;
  read_only: boolean;
}

export interface MembershipList {
  memberships: MembershipSummary[];
  enabled: boolean;
}

export interface MembershipDetail {
  membership: MembershipView;
  ledger: MembershipLedgerEntry[];
}

/** `GET/PUT /console/api/v1/admin/settings/membership`. */
export interface MembershipSettings {
  enabled: boolean;
  period_days: number;
  period_credits: number;
  trial_credits: number;
  retention_days: number;
  auto_purge: boolean;
}

/** `GET /console/api/v1/console/me` while a session has no account yet. */
interface PendingRegistration {
  provider: string;
  /** What the provider reported; empty when it reported nothing (GitHub). */
  email: string;
  name: string;
}

/** `GET /console/api/v1/console/impersonation`: the read-only window, if any. */
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
  /** Unix ms when the account is waiting for an invitation; 0 when active. */
  pending_at?: Millis;
}

export interface UserList {
  users: UserSummary[];
}

interface UserStats {
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

/** One operator-created invitation to register an address. */
export interface RegistrationInvite {
  email: string;
  invited_by: string;
  created_at: Millis;
  /** Unix ms; 0 means no expiry. */
  expires_at: Millis;
  /** Unix ms; 0 means not used yet. */
  used_at: Millis;
  /** Whether a code is also required to register. */
  has_code: boolean;
  /**
   * The rendered invitation, stored with the invite so the console can show the
   * drafted message at any time (the code in it is not recoverable from the
   * hash alone).
   */
  email_subject: string;
  email_body: string;
}

/** The rendered invitation email, so the console can show it to copy. */
interface RegistrationInviteEmail {
  subject: string;
  body: string;
}

/** What creating or re-sending an invitation returns. */
export interface RegistrationInviteResult {
  invite: RegistrationInvite;
  /** Present only when this call issued a code. */
  code?: string;
  email: RegistrationInviteEmail;
}

/**
 * What `POST /console/api/v1/console/pair` returns, once, and what the pair view hands
 * straight to the extension (adr/0020). It is the same shape the invite-code
 * flow has always returned - one device, one token - which is why the
 * extension can save it with the config it already has.
 */
export interface DeviceCredentials {
  user_id: string;
  device_id: string;
  token: string;
  server_rev: number;
  issued_at: IsoTime;
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
  tabspace_title?: string;
  tabspace_created_at?: number;
  tabspace_updated_at?: number;
  tabspace_tabs?: number;
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
