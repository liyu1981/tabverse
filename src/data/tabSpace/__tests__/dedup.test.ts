/**
 * The duplicate decision (`src/data/tabSpace/dedup.ts`).
 *
 * The whole policy is a pure function of a plain tab list, so every rule is one
 * case here with no browser: the URL identity, the keeper's tie-breaks, the
 * protected group, and the re-validation an apply does against the live tabs.
 */
import { describe, expect, test } from 'vitest';

import {
  type DedupTab,
  describeDedup,
  duplicateKey,
  findDuplicateGroups,
  planDedupApply,
  reportFingerprint,
} from '../dedup';

function tab(over: Partial<DedupTab> = {}): DedupTab {
  return {
    chromeTabId: 1,
    chromeWindowId: 10,
    url: 'https://example.com/a',
    title: 'A',
    pinned: false,
    active: false,
    audible: false,
    lastAccessed: 1000,
    index: 0,
    background: false,
    ...over,
  };
}

describe('duplicateKey', () => {
  test('scheme, host and path identify the page; the fragment does not', () => {
    expect(duplicateKey('https://Example.com/Path/')).toBe(
      'https://example.com/Path',
    );
    expect(duplicateKey('https://example.com/a#section')).toBe(
      'https://example.com/a',
    );
  });

  test('a default port is not part of the identity', () => {
    expect(duplicateKey('https://a.example:443/x')).toBe(
      duplicateKey('https://a.example/x'),
    );
  });

  test('the query is kept', () => {
    expect(duplicateKey('https://a.example/x?q=1')).toBe(
      'https://a.example/x?q=1',
    );
    expect(duplicateKey('https://a.example/x?q=1')).not.toBe(
      duplicateKey('https://a.example/x?q=2'),
    );
  });

  test('a trailing slash normalises, but the root stays the root', () => {
    expect(duplicateKey('https://a.example/x/')).toBe('https://a.example/x');
    expect(duplicateKey('https://a.example/')).toBe('https://a.example/');
  });

  test('anything that is not a web page is never a duplicate', () => {
    expect(duplicateKey('chrome://settings')).toBeUndefined();
    expect(duplicateKey('file:///tmp/x.html')).toBeUndefined();
    expect(duplicateKey('about:blank')).toBeUndefined();
    expect(duplicateKey('not a url')).toBeUndefined();
    expect(duplicateKey('')).toBeUndefined();
  });
});

describe('findDuplicateGroups', () => {
  test('two tabs on one URL in one window are a group', () => {
    const groups = findDuplicateGroups([
      tab({ chromeTabId: 1 }),
      tab({ chromeTabId: 2 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].closers.map((c) => c.chromeTabId)).toEqual([2]);
  });

  test('the same URL in two windows is two tabverses, not a duplicate', () => {
    const groups = findDuplicateGroups([
      tab({ chromeTabId: 1, chromeWindowId: 10 }),
      tab({ chromeTabId: 2, chromeWindowId: 11 }),
    ]);
    expect(groups).toHaveLength(0);
  });

  test('the manager tab is never a member', () => {
    const groups = findDuplicateGroups([
      tab({ chromeTabId: 1, background: true }),
      tab({ chromeTabId: 2 }),
    ]);
    expect(groups).toHaveLength(0);
  });

  test('the active copy is the keeper', () => {
    const groups = findDuplicateGroups([
      tab({ chromeTabId: 1 }),
      tab({ chromeTabId: 2, active: true }),
    ]);
    expect(groups[0].keeper.chromeTabId).toBe(2);
    expect(groups[0].closers.map((c) => c.chromeTabId)).toEqual([1]);
  });

  test('audible beats pinned beats recent beats index, in that order', () => {
    const audible = findDuplicateGroups([
      tab({ chromeTabId: 1, pinned: true }),
      tab({ chromeTabId: 2, audible: true }),
    ]);
    expect(audible[0].keeper.chromeTabId).toBe(2);

    const pinned = findDuplicateGroups([
      tab({ chromeTabId: 1, lastAccessed: 9999 }),
      tab({ chromeTabId: 2, pinned: true }),
    ]);
    expect(pinned[0].keeper.chromeTabId).toBe(2);
  });

  test('a full tie falls back to the lowest index', () => {
    const groups = findDuplicateGroups([
      tab({ chromeTabId: 1, index: 5 }),
      tab({ chromeTabId: 2, index: 2 }),
    ]);
    expect(groups[0].keeper.chromeTabId).toBe(2);
  });

  test('a group whose extra copies are pinned is protected, and explains why', () => {
    const groups = findDuplicateGroups([
      tab({ chromeTabId: 1, pinned: true, lastAccessed: 5000 }),
      tab({ chromeTabId: 2, pinned: true }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].closers).toHaveLength(0);
    expect(groups[0].protectedReason).toBe('all other copies are pinned');
  });

  test('a pinned extra copy does not protect the unpinned ones', () => {
    const groups = findDuplicateGroups([
      tab({ chromeTabId: 1, active: true }),
      tab({ chromeTabId: 2, pinned: true }),
      tab({ chromeTabId: 3 }),
    ]);
    expect(groups[0].closers.map((c) => c.chromeTabId)).toEqual([3]);
    expect(groups[0].protectedReason).toBeUndefined();
  });

  test('groups are ordered by how much there is to remove', () => {
    const groups = findDuplicateGroups([
      tab({ chromeTabId: 1, url: 'https://a.example/one' }),
      tab({ chromeTabId: 2, url: 'https://a.example/one' }),
      tab({ chromeTabId: 3, url: 'https://a.example/two' }),
      tab({ chromeTabId: 4, url: 'https://a.example/two' }),
      tab({ chromeTabId: 5, url: 'https://a.example/two' }),
    ]);
    expect(groups.map((g) => g.closers.length)).toEqual([2, 1]);
  });
});

describe('planDedupApply', () => {
  const groups = findDuplicateGroups([
    tab({ chromeTabId: 1, active: true }),
    tab({ chromeTabId: 2 }),
    tab({ chromeTabId: 3 }),
  ]);

  test('closes the closers, keeping the keeper', () => {
    const live = [
      tab({ chromeTabId: 1, active: true }),
      tab({ chromeTabId: 2 }),
      tab({ chromeTabId: 3 }),
    ];
    expect(planDedupApply(groups, live, new Set()).sort()).toEqual([2, 3]);
  });

  test('an ignored key is skipped entirely', () => {
    const live = [
      tab({ chromeTabId: 1, active: true }),
      tab({ chromeTabId: 2 }),
    ];
    expect(planDedupApply(groups, live, new Set([groups[0].key]))).toEqual([]);
  });

  test('a closer that navigated away, was pinned or is gone is dropped', () => {
    const live = [
      tab({ chromeTabId: 1, active: true }),
      tab({ chromeTabId: 2, url: 'https://elsewhere.example/x' }),
      tab({ chromeTabId: 3, pinned: true }),
    ];
    expect(planDedupApply(groups, live, new Set())).toEqual([]);
  });
});

describe('reportFingerprint', () => {
  test('is stable for one set and changes when the set does', () => {
    const one = findDuplicateGroups([
      tab({ chromeTabId: 1, active: true }),
      tab({ chromeTabId: 2 }),
    ]);
    const same = findDuplicateGroups([
      tab({ chromeTabId: 1, active: true }),
      tab({ chromeTabId: 2 }),
    ]);
    const more = findDuplicateGroups([
      tab({ chromeTabId: 1, active: true }),
      tab({ chromeTabId: 2 }),
      tab({ chromeTabId: 3 }),
    ]);
    expect(reportFingerprint(one)).toBe(reportFingerprint(same));
    expect(reportFingerprint(one)).not.toBe(reportFingerprint(more));
  });
});

describe('describeDedup', () => {
  test('says nothing when there is nothing to remove', () => {
    expect(
      describeDedup({
        scannedAt: 0,
        windows: 1,
        tabs: 1,
        groups: [],
        fingerprint: '0',
      }),
    ).toBe('');
  });

  test('counts the closers', () => {
    const groups = findDuplicateGroups([
      tab({ chromeTabId: 1, active: true }),
      tab({ chromeTabId: 2 }),
      tab({ chromeTabId: 3 }),
    ]);
    const line = describeDedup({
      scannedAt: 0,
      windows: 1,
      tabs: 3,
      groups,
      fingerprint: 'x',
    });
    expect(line).toContain('2 duplicate tab');
  });
});
