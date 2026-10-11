/**
 * The persisted tab-suspension settings (`src/data/tabSpace/suspendSettings.ts`).
 *
 * What this pins: absent means off and fifteen minutes (a build that has never
 * written the keys behaves as it did before the feature existed), `null` (not
 * read yet) is a state of its own, a typed threshold is clamped into the band
 * the sweep can act on, and a broken store costs the setting rather than the
 * page.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  MemoryStorageArea,
  type StorageAreaLike,
} from '../../../data/repo/outbox';
import {
  DEFAULT_SUSPEND_AFTER_MINUTES,
  MAX_SUSPEND_AFTER_MINUTES,
  MIN_SUSPEND_AFTER_MINUTES,
  SUSPEND_AFTER_MINUTES_KEY,
  SUSPEND_ENABLED_KEY,
  clampSuspendMinutes,
  getSuspendSettings,
  loadSuspendSettings,
  setSuspendAfterMinutes,
  setSuspendEnabled,
  setSuspendSettingsForTest,
  setSuspendSettingsStorageForTest,
  subscribeSuspendSettings,
} from '../suspendSettings';

let storage: MemoryStorageArea;

beforeEach(() => {
  storage = new MemoryStorageArea();
  setSuspendSettingsStorageForTest(storage);
});

afterEach(() => {
  setSuspendSettingsStorageForTest(null);
});

describe('loadSuspendSettings', () => {
  test('nothing stored means off, fifteen minutes', async () => {
    await expect(loadSuspendSettings()).resolves.toEqual({
      enabled: false,
      afterMinutes: DEFAULT_SUSPEND_AFTER_MINUTES,
    });
    expect(getSuspendSettings()).toEqual({
      enabled: false,
      afterMinutes: DEFAULT_SUSPEND_AFTER_MINUTES,
    });
  });

  test('a stored true is on, and the stored minutes are read', async () => {
    await storage.set({
      [SUSPEND_ENABLED_KEY]: true,
      [SUSPEND_AFTER_MINUTES_KEY]: 60,
    });
    await expect(loadSuspendSettings()).resolves.toEqual({
      enabled: true,
      afterMinutes: 60,
    });
  });

  test('a value that is not exactly true reads as off', async () => {
    await storage.set({ [SUSPEND_ENABLED_KEY]: 'yes' });
    await expect(loadSuspendSettings()).resolves.toMatchObject({
      enabled: false,
    });
  });

  test('a stored threshold outside the band is clamped on read', async () => {
    await storage.set({ [SUSPEND_AFTER_MINUTES_KEY]: 0 });
    await expect(loadSuspendSettings()).resolves.toMatchObject({
      afterMinutes: MIN_SUSPEND_AFTER_MINUTES,
    });
  });

  test('before the first read the answer is null, not off', () => {
    setSuspendSettingsStorageForTest(storage);
    expect(getSuspendSettings()).toEqual({
      enabled: null,
      afterMinutes: null,
    });
  });

  test('an unreadable store reads as the defaults', async () => {
    const broken: StorageAreaLike = {
      get: async () => {
        throw new Error('no storage');
      },
      set: async () => undefined,
      remove: async () => undefined,
    };
    setSuspendSettingsStorageForTest(broken);
    await expect(loadSuspendSettings()).resolves.toEqual({
      enabled: false,
      afterMinutes: DEFAULT_SUSPEND_AFTER_MINUTES,
    });
  });
});

describe('setSuspendEnabled', () => {
  test('saves, and the next read agrees', async () => {
    await setSuspendEnabled(true);
    expect(getSuspendSettings().enabled).toBe(true);
    await expect(loadSuspendSettings()).resolves.toMatchObject({
      enabled: true,
    });
  });

  test('the switch moves before the write lands', async () => {
    const saving = setSuspendEnabled(true);
    expect(getSuspendSettings().enabled).toBe(true);
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
    setSuspendSettingsStorageForTest(broken);
    await expect(setSuspendEnabled(true)).resolves.toBeUndefined();
    expect(getSuspendSettings().enabled).toBe(true);
  });
});

describe('setSuspendAfterMinutes', () => {
  test('saves the clamped value, and the next read agrees', async () => {
    await setSuspendAfterMinutes(1);
    expect(getSuspendSettings().afterMinutes).toBe(MIN_SUSPEND_AFTER_MINUTES);
    await expect(loadSuspendSettings()).resolves.toMatchObject({
      afterMinutes: MIN_SUSPEND_AFTER_MINUTES,
    });
  });

  test('rounds a fractional minute', async () => {
    await setSuspendAfterMinutes(45.6);
    expect(getSuspendSettings().afterMinutes).toBe(46);
  });
});

describe('clampSuspendMinutes', () => {
  test('keeps a value in the band and rounds it', () => {
    expect(clampSuspendMinutes(30)).toBe(30);
    expect(clampSuspendMinutes(1)).toBe(MIN_SUSPEND_AFTER_MINUTES);
    expect(clampSuspendMinutes(99999)).toBe(MAX_SUSPEND_AFTER_MINUTES);
    expect(clampSuspendMinutes(Number.NaN)).toBe(DEFAULT_SUSPEND_AFTER_MINUTES);
  });
});

describe('subscribeSuspendSettings', () => {
  test('hears about a save and a read', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSuspendSettings(listener);
    await setSuspendEnabled(true);
    expect(listener).toHaveBeenCalledTimes(1);
    await loadSuspendSettings();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    await setSuspendEnabled(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('the test hook sets the value without storage', () => {
    setSuspendSettingsForTest({ enabled: true, afterMinutes: 5 });
    expect(getSuspendSettings()).toEqual({ enabled: true, afterMinutes: 5 });
  });
});
