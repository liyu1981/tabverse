/**
 * Sync configuration: where the server is and how this device authenticates.
 *
 * Stored in chrome.storage.local (shared by every extension context and the
 * service worker, unlike localStorage which the MV3 worker cannot see at
 * all - the old code silently lost its settings because of that).
 */

import { DeviceCredentials } from './types';
import {
  ChromeStorageArea,
  MemoryStorageArea,
  StorageAreaLike,
} from './outbox';
import { FetchLike, ServerApiClient } from './serverApi';

export const SYNC_CONFIG_KEY = 'tabverse_sync_config_v1';

export interface SyncConfig {
  baseUrl: string;
  token: string;
  userId?: string;
  deviceId?: string;
  enabled: boolean;
  /** How often the background worker flushes/pulls. */
  autoSyncIntervalMs?: number;
  /**
   * Which setup produced this config (adr/0020): the official-server wizard, or
   * a server the user runs and paired with a code. Display only - both kinds are
   * the same config as far as syncing is concerned. **Absent means custom**,
   * which is every config written before the wizard existed, so no migration
   * reads it: this field answers a question about the past.
   */
  kind?: SyncSetupKind;
}

export type SyncSetupKind = 'official' | 'custom';

export const DEFAULT_SYNC_INTERVAL_MS = 60 * 1000;

export function defaultStorage(): StorageAreaLike {
  return new ChromeStorageArea();
}

export async function loadSyncConfig(
  storage: StorageAreaLike = defaultStorage(),
): Promise<SyncConfig | null> {
  const items = await storage.get([SYNC_CONFIG_KEY]);
  const raw = items[SYNC_CONFIG_KEY];
  if (
    !raw ||
    typeof raw.baseUrl !== 'string' ||
    typeof raw.token !== 'string' ||
    raw.baseUrl === '' ||
    raw.token === ''
  ) {
    return null;
  }
  return {
    baseUrl: raw.baseUrl,
    token: raw.token,
    userId: raw.userId,
    deviceId: raw.deviceId,
    enabled: raw.enabled !== false,
    // a config from before the wizard has no kind, and it was a code pairing
    kind: raw.kind === 'official' ? 'official' : 'custom',
    autoSyncIntervalMs:
      typeof raw.autoSyncIntervalMs === 'number'
        ? raw.autoSyncIntervalMs
        : undefined,
  };
}

export async function saveSyncConfig(
  config: SyncConfig,
  storage: StorageAreaLike = defaultStorage(),
): Promise<void> {
  await storage.set({ [SYNC_CONFIG_KEY]: config });
}

export async function clearSyncConfig(
  storage: StorageAreaLike = defaultStorage(),
): Promise<void> {
  await storage.remove([SYNC_CONFIG_KEY]);
}

/**
 * Pair this device with a server: redeem the invite code, persist the
 * returned credentials and return the ready to use config.
 */
export async function pairWithServer(
  baseUrl: string,
  inviteCode: string,
  deviceName: string,
  storage: StorageAreaLike = defaultStorage(),
  fetchFn?: FetchLike,
): Promise<SyncConfig> {
  const credentials: DeviceCredentials = await ServerApiClient.pair(
    baseUrl,
    inviteCode,
    deviceName,
    fetchFn,
  );
  const config: SyncConfig = {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    token: credentials.token,
    userId: credentials.user_id,
    deviceId: credentials.device_id,
    enabled: true,
    kind: 'custom',
  };
  await saveSyncConfig(config, storage);
  return config;
}

/**
 * Take over credentials the official-server wizard created for us (adr/0020).
 *
 * The same shape `pairWithServer` persists, minus the invite leg: the console
 * minted the device and the token after the person signed in and agreed, and
 * handed them to this extension over the externally_connectable channel. That is
 * the only difference, so this is deliberately the same few lines.
 */
export async function adoptCredentials(
  baseUrl: string,
  credentials: DeviceCredentials,
  storage: StorageAreaLike = defaultStorage(),
): Promise<SyncConfig> {
  const config: SyncConfig = {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    token: credentials.token,
    userId: credentials.user_id,
    deviceId: credentials.device_id,
    enabled: true,
    kind: 'official',
  };
  await saveSyncConfig(config, storage);
  return config;
}

/** Test helper: an in-memory config store. */
export function memoryStorage(): StorageAreaLike {
  return new MemoryStorageArea();
}
