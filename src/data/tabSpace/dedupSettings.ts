/**
 * Whether the duplicate advisor runs, and how often it scans.
 *
 * Two device-level values in `chrome.storage.local`, the same shape as
 * `suspendSettings.ts` and `aiSettings.ts`: absent means the default, `null`
 * (not read yet) is a state of its own, and the write is optimistic.
 *
 * `enabled` defaults **on**: unlike suspension, the advisor never changes
 * browser behaviour - it only watches and, when the person asks, closes tabs
 * they named. A notice they can ignore is not worth hiding behind a switch
 * that a self-hoster would never find.
 */
import { logger } from '../../global';
import {
  ChromeStorageArea,
  type StorageAreaLike,
} from '../../data/repo/outbox';

export const DEDUP_ENABLED_KEY = 'tabverse_dedup_enabled_v1';
export const DEDUP_SCAN_MINUTES_KEY = 'tabverse_dedup_scan_minutes_v1';

export const DEFAULT_DEDUP_SCAN_MINUTES = 10;
export const MIN_DEDUP_SCAN_MINUTES = 1;
export const MAX_DEDUP_SCAN_MINUTES = 1440;

export interface DedupSettings {
  /** null until the first read lands; then on or off. */
  enabled: boolean | null;
  /** null until the first read lands; then minutes inside the band below. */
  minutes: number | null;
}

const UNREAD: DedupSettings = { enabled: null, minutes: null };

let settings: DedupSettings = UNREAD;
let storageOverride: StorageAreaLike | null = null;
const listeners = new Set<() => void>();

function storage(): StorageAreaLike {
  return storageOverride ?? new ChromeStorageArea();
}

function notify(): void {
  for (const listener of Array.from(listeners)) {
    listener();
  }
}

/** Keeps a scan interval inside the band the alarm can honour. */
export function clampDedupMinutes(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_DEDUP_SCAN_MINUTES;
  }
  return Math.min(
    MAX_DEDUP_SCAN_MINUTES,
    Math.max(MIN_DEDUP_SCAN_MINUTES, Math.round(value)),
  );
}

export function getDedupSettings(): DedupSettings {
  return settings;
}

export function subscribeDedupSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function apply(raw: Record<string, unknown>): void {
  const minutes = raw[DEDUP_SCAN_MINUTES_KEY];
  settings = {
    // absent, or anything that is not exactly false, reads as on
    enabled: raw[DEDUP_ENABLED_KEY] !== false,
    minutes:
      typeof minutes === 'number'
        ? clampDedupMinutes(minutes)
        : DEFAULT_DEDUP_SCAN_MINUTES,
  };
  notify();
}

/** Reads both values once; a storage failure reads as the defaults. */
export async function loadDedupSettings(): Promise<DedupSettings> {
  try {
    const raw = await storage().get([
      DEDUP_ENABLED_KEY,
      DEDUP_SCAN_MINUTES_KEY,
    ]);
    apply(raw);
  } catch (err) {
    logger.log('could not read the dedup settings', err);
    settings = { enabled: true, minutes: DEFAULT_DEDUP_SCAN_MINUTES };
    notify();
  }
  return settings;
}

export async function setDedupEnabled(next: boolean): Promise<void> {
  settings = { ...settings, enabled: next };
  notify();
  try {
    await storage().set({ [DEDUP_ENABLED_KEY]: next });
  } catch (err) {
    logger.log('could not save the dedup setting', err);
  }
}

export async function setDedupScanMinutes(next: number): Promise<void> {
  const minutes = clampDedupMinutes(next);
  settings = { ...settings, minutes };
  notify();
  try {
    await storage().set({ [DEDUP_SCAN_MINUTES_KEY]: minutes });
  } catch (err) {
    logger.log('could not save the dedup scan interval', err);
  }
}

/** Test hooks: the cached value and the storage area are module state. */
export function setDedupSettingsStorageForTest(
  area: StorageAreaLike | null,
): void {
  storageOverride = area;
  settings = UNREAD;
  listeners.clear();
}

export function setDedupSettingsForTest(next: DedupSettings): void {
  settings = next;
  notify();
}
