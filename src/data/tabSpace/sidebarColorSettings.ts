/**
 * Whether a new tabverse is given a random sidebar colour.
 *
 * A device preference, not tabverse data: it decides what the *next* tabverse
 * looks like, so there is nothing about it to sync. It keeps the shape
 * `suspendSettings.ts` uses for the same reason:
 *
 * - **Absent means off** - a build that never wrote the key uses the default
 *   colour, exactly as before the feature existed.
 * - **`null` is not `false`** - the panel must not flash as "off" while the
 *   first read is still in flight.
 * - **The write is optimistic** - the switch moves now and the save follows.
 */
import { logger } from '../../global';
import {
  ChromeStorageArea,
  type StorageAreaLike,
} from '../../data/repo/outbox';

export const SIDEBAR_RANDOM_ON_CREATE_KEY =
  'tabverse_sidebar_random_on_create_v1';

let value: boolean | null = null;
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
export function getSidebarRandomOnCreate(): boolean | null {
  return value;
}

export function subscribeSidebarRandomOnCreate(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reads the value once; a storage failure reads as off. */
export async function loadSidebarRandomOnCreate(): Promise<boolean> {
  try {
    const raw = await storage().get([SIDEBAR_RANDOM_ON_CREATE_KEY]);
    value = raw[SIDEBAR_RANDOM_ON_CREATE_KEY] === true;
  } catch (err) {
    logger.log('could not read the sidebar colour setting', err);
    value = false;
  }
  notify();
  return value;
}

export async function setSidebarRandomOnCreate(next: boolean): Promise<void> {
  value = next;
  notify();
  try {
    await storage().set({ [SIDEBAR_RANDOM_ON_CREATE_KEY]: next });
  } catch (err) {
    logger.log('could not save the sidebar colour setting', err);
  }
}

/** Test hook: the cached value and the storage area are module state. */
export function setSidebarRandomOnCreateStorageForTest(
  area: StorageAreaLike | null,
): void {
  storageOverride = area;
  value = null;
  listeners.clear();
}
