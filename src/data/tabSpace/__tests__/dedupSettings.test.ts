/**
 * The persisted duplicate-advisor settings (`src/data/tabSpace/dedupSettings.ts`).
 *
 * What this pins: absent means on and ten minutes (a build that has never
 * written the keys behaves as the feature intends), `null` (not read yet) is a
 * state of its own, a typed interval is clamped into the band the alarm can
 * honour, and a broken store costs the setting rather than the page.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  MemoryStorageArea,
  type StorageAreaLike,
} from '../../../data/repo/outbox';
import {
  DEFAULT_DEDUP_SCAN_MINUTES,
  DEDUP_ENABLED_KEY,
  DEDUP_SCAN_MINUTES_KEY,
  MAX_DEDUP_SCAN_MINUTES,
  MIN_DEDUP_SCAN_MINUTES,
  clampDedupMinutes,
  getDedupSettings,
  loadDedupSettings,
  setDedupEnabled,
  setDedupScanMinutes,
  setDedupSettingsForTest,
  setDedupSettingsStorageForTest,
} from '../dedupSettings';

let storage: MemoryStorageArea;

beforeEach(() => {
  storage = new MemoryStorageArea();
  setDedupSettingsStorageForTest(storage);
});

afterEach(() => {
  setDedupSettingsStorageForTest(null);
});

describe('loadDedupSettings', () => {
  test('nothing stored means on, ten minutes', async () => {
    await expect(loadDedupSettings()).resolves.toEqual({
      enabled: true,
      minutes: DEFAULT_DEDUP_SCAN_MINUTES,
    });
    expect(getDedupSettings()).toEqual({
      enabled: true,
      minutes: DEFAULT_DEDUP_SCAN_MINUTES,
    });
  });

  test('a stored false is off, and the stored interval is read', async () => {
    await storage.set({
      [DEDUP_ENABLED_KEY]: false,
      [DEDUP_SCAN_MINUTES_KEY]: 60,
    });
    await expect(loadDedupSettings()).resolves.toEqual({
      enabled: false,
      minutes: 60,
    });
  });

  test('before the first read the answer is null, not off', () => {
    setDedupSettingsStorageForTest(storage);
    expect(getDedupSettings()).toEqual({ enabled: null, minutes: null });
  });

  test('an unreadable store reads as the defaults', async () => {
    const broken: StorageAreaLike = {
      get: async () => {
        throw new Error('no storage');
      },
      set: async () => undefined,
      remove: async () => undefined,
    };
    setDedupSettingsStorageForTest(broken);
    await expect(loadDedupSettings()).resolves.toEqual({
      enabled: true,
      minutes: DEFAULT_DEDUP_SCAN_MINUTES,
    });
  });
});

describe('setDedupEnabled', () => {
  test('saves, and the next read agrees', async () => {
    await setDedupEnabled(false);
    expect(getDedupSettings().enabled).toBe(false);
    await expect(loadDedupSettings()).resolves.toMatchObject({
      enabled: false,
    });
  });
});

describe('setDedupScanMinutes', () => {
  test('clamps a typed value into the band', async () => {
    await setDedupScanMinutes(0);
    expect(getDedupSettings().minutes).toBe(MIN_DEDUP_SCAN_MINUTES);
    await setDedupScanMinutes(99999);
    expect(getDedupSettings().minutes).toBe(MAX_DEDUP_SCAN_MINUTES);
    expect(clampDedupMinutes(Number.NaN)).toBe(DEFAULT_DEDUP_SCAN_MINUTES);
  });
});

test('setDedupSettingsForTest moves the snapshot', () => {
  setDedupSettingsForTest({ enabled: false, minutes: 5 });
  expect(getDedupSettings()).toEqual({ enabled: false, minutes: 5 });
});
