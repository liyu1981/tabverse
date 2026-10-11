/**
 * The per-tabverse suspension whitelist (`src/data/tabSpace/suspendWhitelist.ts`).
 *
 * Two layers are pinned here: the durable map (our tab ids, in
 * `chrome.storage.local`) and the resolved live set (chrome tab ids, in
 * `chrome.storage.session`) that the worker reads. The resolver between them is
 * a pure function, so it is tested on plain tab objects.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { MemoryStorageArea, type StorageAreaLike } from '../../repo/outbox';
import type { Tab } from '../Tab';
import {
  SUSPEND_WHITELIST_KEY,
  SUSPEND_WHITELIST_SESSION_PREFIX,
  type SessionAreaLike,
  getWhitelistVersion,
  getWhitelistedTabIds,
  isWhitelisted,
  loadWhitelist,
  publishWhitelistForTabSpace,
  readWhitelistedChromeTabIds,
  resolveWhitelistedChromeTabIds,
  setSuspendWhitelistSessionForTest,
  setSuspendWhitelistStorageForTest,
  setWhitelisted,
  subscribeWhitelist,
  toggleWhitelisted,
} from '../suspendWhitelist';

class MemorySessionArea implements SessionAreaLike {
  private data: Record<string, unknown> = {};

  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys === null) {
      return { ...this.data };
    }
    const list = typeof keys === 'string' ? [keys] : keys;
    const out: Record<string, unknown> = {};
    for (const key of list) {
      if (key in this.data) {
        out[key] = this.data[key];
      }
    }
    return out;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.data, items);
  }

  async remove(keys: string | string[]): Promise<void> {
    const list = typeof keys === 'string' ? [keys] : keys;
    for (const key of list) {
      delete this.data[key];
    }
  }
}

let storage: MemoryStorageArea;
let session: MemorySessionArea;

beforeEach(() => {
  storage = new MemoryStorageArea();
  session = new MemorySessionArea();
  setSuspendWhitelistStorageForTest(storage);
  setSuspendWhitelistSessionForTest(session);
});

afterEach(() => {
  setSuspendWhitelistStorageForTest(null);
  setSuspendWhitelistSessionForTest(null);
});

describe('loadWhitelist', () => {
  test('nothing stored is an empty list', async () => {
    await loadWhitelist();
    expect(getWhitelistedTabIds('t1').size).toBe(0);
    expect(isWhitelisted('t1', 'a')).toBe(false);
  });

  test('reads the durable map, and ignores junk', async () => {
    await storage.set({
      [SUSPEND_WHITELIST_KEY]: {
        t1: ['a', 'b'],
        t2: 'not-an-array',
        t3: [1, 'c'],
      },
    });
    await loadWhitelist();
    expect(Array.from(getWhitelistedTabIds('t1')).sort()).toEqual(['a', 'b']);
    expect(getWhitelistedTabIds('t2').size).toBe(0);
    expect(Array.from(getWhitelistedTabIds('t3'))).toEqual(['c']);
  });

  test('an unreadable store reads as empty', async () => {
    const broken: StorageAreaLike = {
      get: async () => {
        throw new Error('no storage');
      },
      set: async () => undefined,
      remove: async () => undefined,
    };
    setSuspendWhitelistStorageForTest(broken);
    await expect(loadWhitelist()).resolves.toBeUndefined();
    expect(getWhitelistedTabIds('t1').size).toBe(0);
  });
});

describe('setWhitelisted and toggleWhitelisted', () => {
  test('adds and removes, and the next read agrees', async () => {
    await setWhitelisted('t1', 'a', true);
    expect(isWhitelisted('t1', 'a')).toBe(true);
    await setWhitelisted('t1', 'a', false);
    expect(isWhitelisted('t1', 'a')).toBe(false);
  });

  test('toggle flips and returns the new state', async () => {
    await expect(toggleWhitelisted('t1', 'a')).resolves.toBe(true);
    await expect(toggleWhitelisted('t1', 'a')).resolves.toBe(false);
  });

  test('a toggle is durable', async () => {
    await toggleWhitelisted('t1', 'a');
    setSuspendWhitelistStorageForTest(storage);
    await loadWhitelist();
    expect(isWhitelisted('t1', 'a')).toBe(true);
  });

  test('an empty tabverse is not stored', async () => {
    await setWhitelisted('t1', 'a', true);
    await setWhitelisted('t1', 'a', false);
    const raw = await storage.get([SUSPEND_WHITELIST_KEY]);
    expect(raw[SUSPEND_WHITELIST_KEY]).toEqual({});
  });

  test('a failing write is not the caller\u2019s problem', async () => {
    const broken: StorageAreaLike = {
      get: async () => ({}),
      set: async () => {
        throw new Error('quota');
      },
      remove: async () => undefined,
    };
    setSuspendWhitelistStorageForTest(broken);
    await expect(setWhitelisted('t1', 'a', true)).resolves.toBeUndefined();
    expect(isWhitelisted('t1', 'a')).toBe(true);
  });

  test('notifies subscribers, and the version moves', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWhitelist(listener);
    const before = getWhitelistVersion();
    await setWhitelisted('t1', 'a', true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getWhitelistVersion()).toBeGreaterThan(before);
    unsubscribe();
    await setWhitelisted('t1', 'a', false);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('resolveWhitelistedChromeTabIds', () => {
  const tabs = [
    { id: 'a', chromeTabId: 10 },
    { id: 'b', chromeTabId: 20 },
    { id: 'c', chromeTabId: -1 }, // a saved tab, no live id
  ] as Tab[];

  test('keeps the live tabs that are whitelisted', () => {
    expect(resolveWhitelistedChromeTabIds(new Set(['a', 'c']), tabs)).toEqual([
      10,
    ]);
  });

  test('an empty whitelist resolves to nothing', () => {
    expect(resolveWhitelistedChromeTabIds(new Set(), tabs)).toEqual([]);
  });
});

describe('the session layer', () => {
  test('publish then read unions every tabverse', async () => {
    await publishWhitelistForTabSpace('t1', [10, 11]);
    await publishWhitelistForTabSpace('t2', [20]);
    const ids = await readWhitelistedChromeTabIds();
    expect(Array.from(ids).sort((a, b) => a - b)).toEqual([10, 11, 20]);
  });

  test('publishing an empty set removes the tabverse', async () => {
    await publishWhitelistForTabSpace('t1', [10]);
    await publishWhitelistForTabSpace('t1', []);
    expect((await readWhitelistedChromeTabIds()).size).toBe(0);
    const raw = await session.get(null);
    expect(
      Object.keys(raw).filter((key) =>
        key.startsWith(SUSPEND_WHITELIST_SESSION_PREFIX),
      ),
    ).toEqual([]);
  });

  test('a missing session area reads as empty', async () => {
    setSuspendWhitelistSessionForTest(null);
    await expect(readWhitelistedChromeTabIds()).resolves.toEqual(new Set());
  });

  test('one tabverse never clobbers another', async () => {
    await publishWhitelistForTabSpace('t1', [10]);
    await publishWhitelistForTabSpace('t2', [20]);
    await publishWhitelistForTabSpace('t1', [11]);
    const ids = await readWhitelistedChromeTabIds();
    expect(Array.from(ids).sort((a, b) => a - b)).toEqual([11, 20]);
  });
});
