/**
 * The duplicate advisor's worker half (`src/data/tabSpace/dedupScan.ts`).
 *
 * The scan is tested with the tab list injected, so "only tabverse windows",
 * "off means no query", and the report shape are pinned with no browser. The
 * apply/undo path is tested the same way: the ids are re-derived from the live
 * tabs, what is closed is recorded, and undo opens it again. The report and the
 * ignore list use in-memory stand-ins for `chrome.storage.session`/`local`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { TABSPACE_MANAGER_TAB_URL_PREFIX } from '../../../global';
import { MemoryStorageArea } from '../../repo/outbox';
import {
  type DedupTabsApi,
  applyDedup,
  alwaysIgnoreDedupKey,
  getDedupReport,
  handleDedupMessage,
  ignoreDedupFingerprint,
  scanForDuplicates,
  setDedupReportForTest,
  setDedupStorageForTest,
  undoDedup,
  visibleDedupReport,
} from '../dedupScan';
import { DedupMsg } from '../../../message/message';

const MANAGER_URL = `${TABSPACE_MANAGER_TAB_URL_PREFIX}?op=new&tvid=x`;

function ctab(over: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 1,
    windowId: 10,
    url: 'https://example.com/a',
    title: 'A',
    pinned: false,
    active: false,
    audible: false,
    index: 0,
    ...over,
  } as chrome.tabs.Tab;
}

function managerTab(windowId: number, id: number): chrome.tabs.Tab {
  return ctab({ id, windowId, url: MANAGER_URL, title: 'Tabverse' });
}

function stubApi(initial: chrome.tabs.Tab[]): {
  api: DedupTabsApi;
  closed: number[][];
  opened: Array<{ url: string; index: number }>;
  query: ReturnType<typeof vi.fn>;
} {
  let current = [...initial];
  const closed: number[][] = [];
  const opened: Array<{ url: string; index: number }> = [];
  const query = vi.fn(async () => [...current]);
  const api: DedupTabsApi = {
    query,
    close: async (ids) => {
      closed.push(ids);
      current = current.filter((tab) => !ids.includes(tab.id ?? -1));
    },
    open: async (tab) => {
      opened.push({ url: tab.url, index: tab.index });
    },
  };
  return { api, closed, opened, query };
}

beforeEach(() => {
  setDedupStorageForTest(new MemoryStorageArea());
});

afterEach(() => {
  setDedupStorageForTest(null);
});

describe('scanForDuplicates', () => {
  test('groups duplicates in a tabverse window and ignores other windows', async () => {
    const { api } = stubApi([
      managerTab(10, 1),
      ctab({ id: 2, windowId: 10 }),
      ctab({ id: 3, windowId: 10, active: true }),
      // window 11 has no manager tab: somebody else's tabs
      ctab({ id: 4, windowId: 11 }),
      ctab({ id: 5, windowId: 11 }),
    ]);
    const report = await scanForDuplicates({
      tabs: api,
      enabled: true,
      now: 5,
    });
    expect(report.windows).toBe(1);
    expect(report.tabs).toBe(3); // the manager tab plus the two duplicates
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0].keeper.chromeTabId).toBe(3);
    expect(report.groups[0].closers.map((c) => c.chromeTabId)).toEqual([2]);
    expect(await getDedupReport()).toEqual(report);
  });

  test('off means no query at all', async () => {
    const { api, query } = stubApi([managerTab(10, 1), ctab({ id: 2 })]);
    const report = await scanForDuplicates({ tabs: api, enabled: false });
    expect(query).not.toHaveBeenCalled();
    expect(report.groups).toEqual([]);
  });
});

describe('apply and undo', () => {
  test('closes the re-validated closer and reopens it on undo', async () => {
    const stub = stubApi([
      managerTab(10, 1),
      ctab({ id: 2, windowId: 10, index: 1 }),
      ctab({ id: 3, windowId: 10, active: true, index: 2 }),
    ]);
    const report = await scanForDuplicates({
      tabs: stub.api,
      enabled: true,
    });
    expect(report.groups[0].closers).toHaveLength(1);

    await applyDedup(report.fingerprint, { tabs: stub.api });
    expect(stub.closed).toEqual([[2]]);
    // the report is refreshed and the duplicate is gone
    expect((await getDedupReport())?.groups).toEqual([]);

    await undoDedup({ tabs: stub.api });
    expect(stub.opened).toEqual([{ url: 'https://example.com/a', index: 1 }]);
  });

  test('a stale fingerprint acts on nothing', async () => {
    const stub = stubApi([managerTab(10, 1), ctab({ id: 2 }), ctab({ id: 3 })]);
    await scanForDuplicates({ tabs: stub.api, enabled: true });
    await applyDedup('not-the-fingerprint', { tabs: stub.api });
    expect(stub.closed).toEqual([]);
  });

  test('a closer that a URL ignores is not closed, and the group goes', async () => {
    const stub = stubApi([managerTab(10, 1), ctab({ id: 2 }), ctab({ id: 3 })]);
    const report = await scanForDuplicates({
      tabs: stub.api,
      enabled: true,
    });
    await alwaysIgnoreDedupKey(report.groups[0].key, { tabs: stub.api });
    expect(stub.closed).toEqual([]);
    expect((await getDedupReport())?.groups).toEqual([]);
  });
});

describe('visibleDedupReport', () => {
  test('an ignored fingerprint is hidden, and a new set shows again', async () => {
    const stub = stubApi([managerTab(10, 1), ctab({ id: 2 }), ctab({ id: 3 })]);
    const report = await scanForDuplicates({
      tabs: stub.api,
      enabled: true,
    });
    await ignoreDedupFingerprint(report.fingerprint);
    expect(await visibleDedupReport()).toBeNull();

    // a third copy is a new fingerprint -> the notice returns
    stub.api.query = async () => [
      managerTab(10, 1),
      ctab({ id: 2 }),
      ctab({ id: 3 }),
      ctab({ id: 4 }),
    ];
    const next = await scanForDuplicates({ tabs: stub.api, enabled: true });
    expect(next.fingerprint).not.toBe(report.fingerprint);
    expect(await visibleDedupReport()).not.toBeNull();
  });
});

describe('handleDedupMessage', () => {
  test('RequestReport answers with the visible report', async () => {
    setDedupReportForTest({
      scannedAt: 1,
      windows: 1,
      tabs: 2,
      groups: [
        {
          key: 'k',
          url: 'https://a.example/x',
          windowId: 10,
          keeper: {
            chromeTabId: 1,
            title: 'a',
            url: 'https://a.example/x',
            pinned: false,
            active: true,
            audible: false,
          },
          closers: [
            {
              chromeTabId: 2,
              title: 'a',
              url: 'https://a.example/x',
              pinned: false,
              active: false,
              audible: false,
            },
          ],
        },
      ],
      fingerprint: 'fp',
    });
    const answer = await new Promise((resolve) => {
      const handled = handleDedupMessage(
        { type: DedupMsg.RequestReport },
        resolve,
      );
      expect(handled).toBe(true);
    });
    expect(answer).toMatchObject({ fingerprint: 'fp' });
  });

  test('a message it does not own is left for another listener', () => {
    expect(
      handleDedupMessage({ type: 'something_else' }, () => undefined),
    ).toBe(false);
  });
});
