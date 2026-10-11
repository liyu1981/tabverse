/**
 * Whether the on-device AI features are wanted, and whether they are known to
 * be wanted yet.
 *
 * Two things are true at once and easy to conflate, which is why this is its
 * own module rather than a row of `availability.ts`:
 *
 * - **Availability is the browser's answer** - this device has no built-in
 *   model, or it has one downloading, or it has one ready.
 * - **Enabled is the person's answer** - whether the extension should offer the
 *   features at all. A device can have the model ready and the feature switched
 *   off, and the other way round.
 *
 * The value lives in `chrome.storage.local` (a device setting, like the sync
 * config - not a window-local ui preference), and **absent means on**: the
 * features are offered until someone turns them off, so a build that has never
 * written the key behaves exactly as it did before the switch existed.
 *
 * `enabled` is null until the first read lands, and `null` is not `false`: the
 * control must not flash as "off" while the answer is still in flight.
 */
import { logger } from '../global';
import { ChromeStorageArea, type StorageAreaLike } from '../data/repo/outbox';

export const AI_ENABLED_KEY = 'tabverse_ai_enabled_v1';

let enabled: boolean | null = null;
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

/** null until the first read lands; then on or off. */
export function getAiEnabled(): boolean | null {
  return enabled;
}

export function subscribeAiEnabled(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reads the setting once; a storage failure reads as "on" (the default). */
export async function loadAiEnabled(): Promise<boolean> {
  try {
    const items = await storage().get([AI_ENABLED_KEY]);
    enabled = items[AI_ENABLED_KEY] !== false;
  } catch (err) {
    logger.log('could not read the AI setting', err);
    enabled = true;
  }
  notify();
  return enabled;
}

/**
 * Saves the setting, optimistically: the switch moves now and the write follows,
 * because a checkbox that waits for storage feels broken. A failed write is
 * logged and left at what the person chose - the next read is what settles it.
 */
export async function setAiEnabled(next: boolean): Promise<void> {
  enabled = next;
  notify();
  try {
    await storage().set({ [AI_ENABLED_KEY]: next });
  } catch (err) {
    logger.log('could not save the AI setting', err);
  }
}

/** Test hooks: the cached value and the storage area are module state. */
export function setAiSettingsStorageForTest(
  area: StorageAreaLike | null,
): void {
  storageOverride = area;
  enabled = null;
  listeners.clear();
}

export function setAiEnabledForTest(next: boolean | null): void {
  enabled = next;
  notify();
}
