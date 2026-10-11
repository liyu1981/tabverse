/**
 * The persisted "on-device AI is wanted" setting (`src/ai/aiSettings.ts`).
 *
 * What this pins: absent means on (a build that has never written the key
 * behaves as it did before the switch existed), the switch saves and is
 * notified, `null` (not read yet) is a state of its own, and a broken store
 * costs the setting rather than the page.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  MemoryStorageArea,
  type StorageAreaLike,
} from '../../data/repo/outbox';
import {
  AI_ENABLED_KEY,
  getAiEnabled,
  loadAiEnabled,
  setAiEnabled,
  setAiEnabledForTest,
  setAiSettingsStorageForTest,
  subscribeAiEnabled,
} from '../aiSettings';

let storage: MemoryStorageArea;

beforeEach(() => {
  storage = new MemoryStorageArea();
  setAiSettingsStorageForTest(storage);
});

afterEach(() => {
  setAiSettingsStorageForTest(null);
});

describe('loadAiEnabled', () => {
  test('nothing stored means on', async () => {
    await expect(loadAiEnabled()).resolves.toBe(true);
    expect(getAiEnabled()).toBe(true);
  });

  test('a stored false is off, and a stored true is on', async () => {
    await storage.set({ [AI_ENABLED_KEY]: false });
    await expect(loadAiEnabled()).resolves.toBe(false);

    await storage.set({ [AI_ENABLED_KEY]: true });
    await expect(loadAiEnabled()).resolves.toBe(true);
  });

  test('before the first read the answer is null, not off', () => {
    setAiSettingsStorageForTest(storage);
    expect(getAiEnabled()).toBeNull();
  });

  test('an unreadable store reads as on, the default', async () => {
    const broken: StorageAreaLike = {
      get: async () => {
        throw new Error('no storage');
      },
      set: async () => undefined,
      remove: async () => undefined,
    };
    setAiSettingsStorageForTest(broken);
    await expect(loadAiEnabled()).resolves.toBe(true);
  });
});

describe('setAiEnabled', () => {
  test('saves, and the next read agrees', async () => {
    await setAiEnabled(false);
    expect(getAiEnabled()).toBe(false);
    await expect(loadAiEnabled()).resolves.toBe(false);
  });

  test('the switch moves before the write lands', async () => {
    // the value is optimistic: the caller does not await to see it
    const saving = setAiEnabled(false);
    expect(getAiEnabled()).toBe(false);
    await saving;
  });

  test('a failing write is not the caller\u2019s problem', async () => {
    const broken: StorageAreaLike = {
      get: async () => ({}),
      set: async () => {
        throw new Error('quota');
      },
      remove: async () => undefined,
    };
    setAiSettingsStorageForTest(broken);
    await expect(setAiEnabled(false)).resolves.toBeUndefined();
    // and it is left at what the person chose
    expect(getAiEnabled()).toBe(false);
  });
});

describe('subscribeAiEnabled', () => {
  test('hears about a save and a read', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAiEnabled(listener);
    await setAiEnabled(false);
    expect(listener).toHaveBeenCalledTimes(1);
    await loadAiEnabled();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    await setAiEnabled(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('the test hook sets the value without storage', () => {
    setAiEnabledForTest(false);
    expect(getAiEnabled()).toBe(false);
    setAiEnabledForTest(null);
    expect(getAiEnabled()).toBeNull();
  });
});
