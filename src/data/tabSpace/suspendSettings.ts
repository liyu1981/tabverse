/**
 * Whether inactive tabs may be suspended, and after how long.
 *
 * Two device-level values, in `chrome.storage.local` (like the sync config and
 * the AI switch - not a window-local ui preference): whether *this* machine
 * unloads idle tabs has nothing to do with another device, so none of it is
 * synced.
 *
 * The shape is deliberately the same as `src/ai/aiSettings.ts`:
 *
 * - **Absent means the default** - off, and fifteen minutes - so a build that
 *   has never written the keys behaves as it did before the switch existed.
 * - **`null` is not `false`** - the panel must not flash as "off" while the
 *   first read is still in flight.
 * - **The write is optimistic** - the switch moves now and the save follows,
 *   because a control that waits for storage feels broken.
 *
 * `enabled` defaults **off**: suspension changes browser behaviour and can lose
 * in-page state on reload, so it is opted into, not inherited.
 */
import { logger } from '../../global';
import {
  ChromeStorageArea,
  type StorageAreaLike,
} from '../../data/repo/outbox';

export const SUSPEND_ENABLED_KEY = 'tabverse_suspend_enabled_v1';
export const SUSPEND_AFTER_MINUTES_KEY = 'tabverse_suspend_after_minutes_v1';

export const DEFAULT_SUSPEND_AFTER_MINUTES = 15;
export const MIN_SUSPEND_AFTER_MINUTES = 5;
export const MAX_SUSPEND_AFTER_MINUTES = 1440;

export interface SuspendSettings {
  /** null until the first read lands; then on or off. */
  enabled: boolean | null;
  /** null until the first read lands; then minutes inside the band below. */
  afterMinutes: number | null;
}

const UNREAD: SuspendSettings = { enabled: null, afterMinutes: null };

let settings: SuspendSettings = UNREAD;
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

/** Keeps a threshold inside the band the sweep can act on. */
export function clampSuspendMinutes(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SUSPEND_AFTER_MINUTES;
  }
  return Math.min(
    MAX_SUSPEND_AFTER_MINUTES,
    Math.max(MIN_SUSPEND_AFTER_MINUTES, Math.round(value)),
  );
}

/** The cached value; the object identity changes only when the value does. */
export function getSuspendSettings(): SuspendSettings {
  return settings;
}

export function subscribeSuspendSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function apply(raw: Record<string, unknown>): void {
  const minutes = raw[SUSPEND_AFTER_MINUTES_KEY];
  settings = {
    // absent, or anything that is not exactly true, reads as off
    enabled: raw[SUSPEND_ENABLED_KEY] === true,
    afterMinutes:
      typeof minutes === 'number'
        ? clampSuspendMinutes(minutes)
        : DEFAULT_SUSPEND_AFTER_MINUTES,
  };
  notify();
}

/** Reads both values once; a storage failure reads as the defaults. */
export async function loadSuspendSettings(): Promise<SuspendSettings> {
  try {
    const raw = await storage().get([
      SUSPEND_ENABLED_KEY,
      SUSPEND_AFTER_MINUTES_KEY,
    ]);
    apply(raw);
  } catch (err) {
    logger.log('could not read the suspension settings', err);
    settings = {
      enabled: false,
      afterMinutes: DEFAULT_SUSPEND_AFTER_MINUTES,
    };
    notify();
  }
  return settings;
}

export async function setSuspendEnabled(next: boolean): Promise<void> {
  settings = { ...settings, enabled: next };
  notify();
  try {
    await storage().set({ [SUSPEND_ENABLED_KEY]: next });
  } catch (err) {
    logger.log('could not save the suspension setting', err);
  }
}

export async function setSuspendAfterMinutes(next: number): Promise<void> {
  const minutes = clampSuspendMinutes(next);
  settings = { ...settings, afterMinutes: minutes };
  notify();
  try {
    await storage().set({ [SUSPEND_AFTER_MINUTES_KEY]: minutes });
  } catch (err) {
    logger.log('could not save the suspension setting', err);
  }
}

/** Test hooks: the cached value and the storage area are module state. */
export function setSuspendSettingsStorageForTest(
  area: StorageAreaLike | null,
): void {
  storageOverride = area;
  settings = UNREAD;
  listeners.clear();
}

export function setSuspendSettingsForTest(next: SuspendSettings): void {
  settings = next;
  notify();
}
