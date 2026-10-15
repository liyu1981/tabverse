/**
 * The random-colour-on-create preference
 * (`src/data/tabSpace/sidebarColorSettings.ts`).
 *
 * The same shape `suspendSettings` pins: absent means off, `null` (not read
 * yet) is a state of its own, the write is optimistic, and a broken store costs
 * the setting rather than the page.
 */
import { afterEach, beforeEach, expect, test } from 'vitest';

import {
  MemoryStorageArea,
  type StorageAreaLike,
} from '../../../data/repo/outbox';
import {
  SIDEBAR_RANDOM_ON_CREATE_KEY,
  getSidebarRandomOnCreate,
  loadSidebarRandomOnCreate,
  setSidebarRandomOnCreate,
  setSidebarRandomOnCreateStorageForTest,
  subscribeSidebarRandomOnCreate,
} from '../sidebarColorSettings';

let storage: MemoryStorageArea;

beforeEach(() => {
  storage = new MemoryStorageArea();
  setSidebarRandomOnCreateStorageForTest(storage);
});

afterEach(() => {
  setSidebarRandomOnCreateStorageForTest(null);
});

test('nothing stored means off', async () => {
  await expect(loadSidebarRandomOnCreate()).resolves.toBe(false);
  expect(getSidebarRandomOnCreate()).toBe(false);
});

test('a stored true is on', async () => {
  await storage.set({ [SIDEBAR_RANDOM_ON_CREATE_KEY]: true });
  await expect(loadSidebarRandomOnCreate()).resolves.toBe(true);
});

test('a value that is not exactly true reads as off', async () => {
  await storage.set({ [SIDEBAR_RANDOM_ON_CREATE_KEY]: 'yes' });
  await expect(loadSidebarRandomOnCreate()).resolves.toBe(false);
});

test('before the first read the answer is null, not off', () => {
  setSidebarRandomOnCreateStorageForTest(storage);
  expect(getSidebarRandomOnCreate()).toBeNull();
});

test('an unreadable store reads as off', async () => {
  const broken: StorageAreaLike = {
    get: async () => {
      throw new Error('no storage');
    },
    set: async () => undefined,
    remove: async () => undefined,
  };
  setSidebarRandomOnCreateStorageForTest(broken);
  await expect(loadSidebarRandomOnCreate()).resolves.toBe(false);
});

test('the switch moves before the write lands, and the write saves', async () => {
  const saving = setSidebarRandomOnCreate(true);
  expect(getSidebarRandomOnCreate()).toBe(true);
  await saving;
  await expect(loadSidebarRandomOnCreate()).resolves.toBe(true);
});

test('a failing write is not the caller\u2019s problem', async () => {
  const broken: StorageAreaLike = {
    get: async () => ({}),
    set: async () => {
      throw new Error('nope');
    },
    remove: async () => undefined,
  };
  setSidebarRandomOnCreateStorageForTest(broken);
  await expect(setSidebarRandomOnCreate(true)).resolves.toBeUndefined();
  expect(getSidebarRandomOnCreate()).toBe(true);
});

test('subscribers hear about a change', async () => {
  const heard: Array<boolean | null> = [];
  const unsubscribe = subscribeSidebarRandomOnCreate(() => {
    heard.push(getSidebarRandomOnCreate());
  });
  await setSidebarRandomOnCreate(true);
  unsubscribe();
  expect(heard).toContain(true);
});
