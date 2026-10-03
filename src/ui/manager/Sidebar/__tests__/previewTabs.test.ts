/**
 * The data behind the hover panel: a window's tabs, minus the tabverse's own
 * Tabverse tab, in tab strip order.
 *
 * The source is the live window, not the tabverse's saved rows, so this runs
 * over the chrome mock's tabs rather than over anything in IndexedDB.
 */

import { expect, test, beforeEach } from 'vitest';

import { getMockChrome } from '../../../../dev/chromeMock';
import {
  clearTabversePreviewCache,
  lastPreviewOfWindow,
  PREVIEW_TAB_LIMIT,
  previewTabsOfWindow,
  readTabversePreview,
} from '../../../../data/tabSpace/tabversePreview';
import { TABSPACE_MANAGER_TAB_URL_PREFIX } from '../../../../global';

const managerUrl = (tvid: string) =>
  `${TABSPACE_MANAGER_TAB_URL_PREFIX}?op=new&tvid=${tvid}`;

const page = (url: string, title = url, pinned = false) =>
  ({
    id: undefined,
    windowId: 1,
    url,
    title,
    favIconUrl: '',
    pinned,
  }) as unknown as chrome.tabs.Tab;

let nextId = 100;
const tab = (over: Partial<chrome.tabs.Tab> = {}) =>
  ({
    id: nextId++,
    windowId: 1,
    url: 'https://example.com/',
    title: 'Example',
    favIconUrl: '',
    pinned: false,
    ...over,
  }) as chrome.tabs.Tab;

beforeEach(() => {
  clearTabversePreviewCache();
});

test("the tabverse's own Tabverse tab is not one of its tabs", () => {
  const tabs = previewTabsOfWindow([
    tab({ id: 1, url: 'https://a.com' }),
    tab({ id: 2, url: managerUrl('ts-a'), title: 'Tabverse' }),
    tab({ id: 3, url: 'https://b.com' }),
  ]);

  expect(tabs.map((t) => t.url)).toEqual(['https://a.com', 'https://b.com']);
});

test('the strip order is kept, and the list is capped', () => {
  const many = Array.from({ length: 10 }, (_, i) =>
    tab({ id: i, url: `https://example.com/${i}` }),
  );

  expect(previewTabsOfWindow(many).map((t) => t.chromeTabId)).toEqual([
    0, 1, 2, 3,
  ]);
  expect(previewTabsOfWindow(many, 2).map((t) => t.chromeTabId)).toEqual([
    0, 1,
  ]);
  expect(PREVIEW_TAB_LIMIT).toEqual(4);
});

test('a tab with no title yet falls back to its url rather than a blank row', () => {
  const rows = previewTabsOfWindow([
    tab({ id: 1, url: 'https://untitled.example/', title: '' }),
  ]);
  expect(rows[0].title).toEqual('https://untitled.example/');
});

test('pinned and favicon travel with the row', () => {
  const rows = previewTabsOfWindow([
    tab({ id: 1, url: 'https://pinned.com', pinned: true }),
    tab({
      id: 2,
      url: 'https://icon.com',
      favIconUrl: 'https://icon.com/i.png',
    }),
  ]);
  expect(rows.map((r) => r.pinned)).toEqual([true, false]);
  expect(rows[1].favIconUrl).toEqual('https://icon.com/i.png');
});

test('a window with nothing in it previews as empty, not as an error', () => {
  expect(previewTabsOfWindow([])).toEqual([]);
  expect(previewTabsOfWindow([tab({ url: managerUrl('ts-only') })])).toEqual(
    [],
  );
});

test('reading a window counts every tab but lists the first few', async () => {
  const mockChrome = getMockChrome();
  const w1 = mockChrome.addWindow();
  for (let i = 0; i < 6; i++) {
    mockChrome.insertTabFromData(
      {
        title: `page ${i}`,
        url: `https://example.com/${i}`,
        favIconUrl: '',
        pinned: false,
      },
      w1.id,
    );
  }
  // the tabverse's own tab, which must not be counted either
  mockChrome.insertTabFromData(
    {
      title: 'Tabverse',
      url: managerUrl('ts-a'),
      favIconUrl: '',
      pinned: true,
    },
    w1.id,
  );

  const preview = await readTabversePreview(w1.id);

  expect(preview.windowId).toEqual(w1.id);
  expect(preview.tabCount).toEqual(6);
  expect(preview.tabs.map((t) => t.url)).toEqual([
    'https://example.com/0',
    'https://example.com/1',
    'https://example.com/2',
    'https://example.com/3',
  ]);
  // and the read is remembered, so a second hover does not query again
  expect(lastPreviewOfWindow(w1.id)).toBe(preview);
});

test('a window that cannot be read is empty rather than a rejection', async () => {
  const preview = await readTabversePreview(4242);
  expect(preview.tabCount).toEqual(0);
  expect(preview.tabs).toEqual([]);
  expect(lastPreviewOfWindow(4242)).toBe(preview);
});

test('page() builds a tab for the fixtures above', () => {
  // keeps the helper honest: the tests that use it would otherwise be asserting
  // against a shape nothing produces
  expect(page('https://x.com').url).toEqual('https://x.com');
});
