/**
 * The tab-suspension decision and the worker sweep
 * (`src/data/tabSpace/suspender.ts`).
 *
 * The policy is a pure function of what Chrome says about each tab, so every
 * skip rule is one case here, with no browser: active, pinned, audible, already
 * discarded, `autoDiscardable: false`, the manager tab, whitelisted, an unknown
 * clock, and the threshold boundary. The sweep is tested with the tab list and
 * the discard call injected, which is how "off means no query" and "a failure
 * does not stop the pass" are pinned.
 */
import { describe, expect, test, vi } from 'vitest';

import { TABSPACE_MANAGER_TAB_URL_PREFIX } from '../../../global';
import {
  type SuspendCandidate,
  describeSuspension,
  suspendInactiveTabs,
  tabsToSuspend,
} from '../suspender';

const NOW = 10_000_000;
const AFTER = 30 * 60_000; // 30 minutes, the default window

function candidate(over: Partial<SuspendCandidate> = {}): SuspendCandidate {
  return {
    chromeTabId: 1,
    lastAccessed: NOW - AFTER - 1,
    active: false,
    pinned: false,
    audible: false,
    discarded: false,
    autoDiscardable: true,
    isManagerTab: false,
    whitelisted: false,
    ...over,
  };
}

describe('tabsToSuspend', () => {
  test('an old, quiet, unprotected tab is suspended', () => {
    expect(tabsToSuspend([candidate()], NOW, AFTER)).toEqual([1]);
  });

  test('an empty list has nothing to do', () => {
    expect(tabsToSuspend([], NOW, AFTER)).toEqual([]);
  });

  const skips: Array<[string, Partial<SuspendCandidate>]> = [
    ['active', { active: true }],
    ['pinned', { pinned: true }],
    ['audible', { audible: true }],
    ['already discarded', { discarded: true }],
    ['autoDiscardable false', { autoDiscardable: false }],
    ['the manager tab', { isManagerTab: true }],
    ['whitelisted', { whitelisted: true }],
    ['an unknown clock', { lastAccessed: undefined }],
    ['younger than the window', { lastAccessed: NOW - AFTER + 1 }],
  ];

  test.each(skips)('a %s tab is skipped', (_name, over) => {
    expect(tabsToSuspend([candidate(over)], NOW, AFTER)).toEqual([]);
  });

  test('exactly at the threshold is old enough', () => {
    expect(
      tabsToSuspend([candidate({ lastAccessed: NOW - AFTER })], NOW, AFTER),
    ).toEqual([1]);
  });

  test('only the tabs that qualify come back, in order', () => {
    const doomed = tabsToSuspend(
      [
        candidate({ chromeTabId: 1 }),
        candidate({ chromeTabId: 2, active: true }),
        candidate({ chromeTabId: 3 }),
      ],
      NOW,
      AFTER,
    );
    expect(doomed).toEqual([1, 3]);
  });
});

function tab(over: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 1,
    windowId: 1,
    url: 'https://example.com',
    active: false,
    pinned: false,
    audible: false,
    discarded: false,
    autoDiscardable: true,
    lastAccessed: NOW - AFTER - 1,
    ...over,
  } as chrome.tabs.Tab;
}

function managerTab(over: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return tab({
    id: 99,
    url: `${TABSPACE_MANAGER_TAB_URL_PREFIX}?op=new&tvid=t1`,
    ...over,
  });
}

describe('suspendInactiveTabs', () => {
  test('off is a no-op before it queries anything', async () => {
    const queryTabs = vi.fn();
    const report = await suspendInactiveTabs({
      settings: { enabled: false, afterMinutes: 30 },
      queryTabs,
      now: NOW,
    });
    expect(report).toMatchObject({ enabled: false, suspended: 0 });
    expect(queryTabs).not.toHaveBeenCalled();
  });

  test('suspends only the old, quiet tab of the tabverse window', async () => {
    const discard = vi.fn(async () => undefined);
    const report = await suspendInactiveTabs({
      settings: { enabled: true, afterMinutes: 30 },
      whitelistedChromeTabIds: new Set(),
      now: NOW,
      queryTabs: async () => [
        managerTab(),
        tab({ id: 1, lastAccessed: NOW - AFTER - 1 }),
        tab({ id: 2, lastAccessed: NOW - 1000 }),
      ],
      discard,
    });
    expect(report).toMatchObject({
      enabled: true,
      scanned: 3,
      windows: 1,
      suspended: 1,
      failed: 0,
    });
    expect(discard).toHaveBeenCalledTimes(1);
    expect(discard).toHaveBeenCalledWith(1);
  });

  test('a window without a manager tab is left alone', async () => {
    const discard = vi.fn(async () => undefined);
    const report = await suspendInactiveTabs({
      settings: { enabled: true, afterMinutes: 30 },
      whitelistedChromeTabIds: new Set(),
      now: NOW,
      queryTabs: async () => [
        managerTab(),
        tab({ id: 1, windowId: 1 }),
        tab({ id: 2, windowId: 2 }),
      ],
      discard,
    });
    expect(report.scanned).toBe(2); // the manager tab and window 1's tab
    expect(discard).toHaveBeenCalledTimes(1);
    expect(discard).toHaveBeenCalledWith(1);
  });

  test('the manager tab is never a candidate, even when it is old', async () => {
    const discard = vi.fn(async () => undefined);
    const report = await suspendInactiveTabs({
      settings: { enabled: true, afterMinutes: 30 },
      whitelistedChromeTabIds: new Set(),
      now: NOW,
      queryTabs: async () => [managerTab()],
      discard,
    });
    expect(report.suspended).toBe(0);
    expect(discard).not.toHaveBeenCalled();
  });

  test('a whitelisted tab is skipped', async () => {
    const discard = vi.fn(async () => undefined);
    const report = await suspendInactiveTabs({
      settings: { enabled: true, afterMinutes: 30 },
      whitelistedChromeTabIds: new Set([1]),
      now: NOW,
      queryTabs: async () => [managerTab(), tab({ id: 1 })],
      discard,
    });
    expect(report.suspended).toBe(0);
    expect(discard).not.toHaveBeenCalled();
  });

  test('a failed discard is counted and does not stop the pass', async () => {
    const discard = vi.fn(async (chromeTabId: number) => {
      if (chromeTabId === 1) {
        throw new Error('Chrome said no');
      }
      return undefined;
    });
    const report = await suspendInactiveTabs({
      settings: { enabled: true, afterMinutes: 30 },
      whitelistedChromeTabIds: new Set(),
      now: NOW,
      queryTabs: async () => [managerTab(), tab({ id: 1 }), tab({ id: 2 })],
      discard,
    });
    expect(report).toMatchObject({ suspended: 1, failed: 1 });
    expect(discard).toHaveBeenCalledTimes(2);
  });

  test('a tab list that will not load leaves the pass at nothing', async () => {
    const report = await suspendInactiveTabs({
      settings: { enabled: true, afterMinutes: 30 },
      now: NOW,
      queryTabs: async () => {
        throw new Error('no tabs');
      },
    });
    expect(report).toMatchObject({ enabled: true, scanned: 0, suspended: 0 });
  });
});

describe('describeSuspension', () => {
  test('says nothing when the switch is off or nothing happened', () => {
    expect(
      describeSuspension({
        enabled: false,
        scanned: 0,
        windows: 0,
        suspended: 0,
        failed: 0,
      }),
    ).toBe('');
    expect(
      describeSuspension({
        enabled: true,
        scanned: 3,
        windows: 1,
        suspended: 0,
        failed: 0,
      }),
    ).toBe('');
  });

  test('reports what it suspended, and any failures', () => {
    expect(
      describeSuspension({
        enabled: true,
        scanned: 5,
        windows: 2,
        suspended: 2,
        failed: 1,
      }),
    ).toContain('suspended 2 inactive tab(s) across 2 tabverse window(s)');
    expect(
      describeSuspension({
        enabled: true,
        scanned: 5,
        windows: 2,
        suspended: 2,
        failed: 1,
      }),
    ).toContain('1 failed');
  });
});
