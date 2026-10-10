import { Tab } from '../Tab';
import { isSameTabUrl, normalizedTabUrl, planRestore } from '../restorePlan';
import { newEmptyTab, setPinned, setTitle, setUrl } from '../Tab';

function savedTab(title: string, url: string, pinned = false): Tab {
  return setPinned(pinned, setUrl(url, setTitle(title, newEmptyTab())));
}

const windowTab = (id: number, url?: string) => ({ id, url });

/** The tabverse's own manager page, which is never reused and never closed. */
const TABVERSE_TAB_ID = 1;

test('the origin is compared case insensitively, the path is not', () => {
  expect(normalizedTabUrl('https://Example.com/Path')).toBe(
    'https://example.com/Path',
  );
  expect(isSameTabUrl('https://EXAMPLE.com/a', 'https://example.com/a')).toBe(
    true,
  );
  expect(
    isSameTabUrl('https://example.com/Page', 'https://example.com/page'),
  ).toBe(false);
});

test('a trailing slash and a fragment are not part of the page', () => {
  expect(isSameTabUrl('https://example.com', 'https://example.com/')).toBe(
    true,
  );
  expect(isSameTabUrl('https://example.com/a/', 'https://example.com/a')).toBe(
    true,
  );
  expect(
    isSameTabUrl('https://example.com/a#part', 'https://example.com/a'),
  ).toBe(true);
  // ... but a query string is: it is a different answer from the server
  expect(
    isSameTabUrl('https://example.com/a?page=2', 'https://example.com/a'),
  ).toBe(false);
  expect(normalizedTabUrl('chrome://newtab/')).toBe('chrome://newtab');
});

test('a tab that has not navigated anywhere is not a page to reuse', () => {
  expect(normalizedTabUrl(undefined)).toBe('');
  expect(normalizedTabUrl('')).toBe('');
  expect(isSameTabUrl(undefined, 'https://example.com')).toBe(false);
  expect(isSameTabUrl('https://example.com', undefined)).toBe(false);
});

test('a tab that is already open here is reused, not opened again', () => {
  const saved = [savedTab('Docs', 'https://example.com/docs')];
  const plan = planRestore(
    saved,
    [windowTab(TABVERSE_TAB_ID), windowTab(7, 'https://example.com/docs')],
    TABVERSE_TAB_ID,
  );

  expect(plan.createTabs).toEqual([]);
  expect(plan.entries[0].reuseChromeTabId).toBe(7);
});

test('a tab that is not open here is opened', () => {
  const saved = [savedTab('Docs', 'https://example.com/docs')];
  const plan = planRestore(
    saved,
    [windowTab(TABVERSE_TAB_ID), windowTab(7, 'https://other.test/')],
    TABVERSE_TAB_ID,
  );

  expect(plan.entries[0].reuseChromeTabId).toBeUndefined();
  expect(plan.createTabs.map((tab) => tab.url)).toEqual([
    'https://example.com/docs',
  ]);
  // the window's own tab is not in the plan at all: a merge decides what to
  // open, never what to close
  expect(plan.entries.map((entry) => entry.reuseChromeTabId)).toEqual([
    undefined,
  ]);
});

test('a window with nothing of the tabverse in it is opened whole', () => {
  const saved = [
    savedTab('A', 'https://a.test/'),
    savedTab('B', 'https://b.test/'),
  ];
  const plan = planRestore(
    saved,
    [windowTab(2, 'https://x.test/'), windowTab(3, 'https://y.test/')],
    1,
  );

  expect(plan.createTabs).toEqual(saved);
});

test('the tabverse tab is never reused', () => {
  // a tabverse that somehow holds its own manager page must not adopt it: the
  // page doing the restoring is that tab
  const saved = [
    savedTab('Tabverse', 'chrome-extension://abc/manager.html?op=new&tvid=x'),
  ];
  const plan = planRestore(
    saved,
    [
      windowTab(
        TABVERSE_TAB_ID,
        'chrome-extension://abc/manager.html?op=new&tvid=x',
      ),
    ],
    TABVERSE_TAB_ID,
  );

  expect(plan.createTabs).toEqual(saved);
});

test('the same url twice in the tabverse reuses two open tabs, not one', () => {
  const saved = [
    savedTab('New tab', 'chrome://newtab/'),
    savedTab('New tab', 'chrome://newtab/'),
    savedTab('New tab', 'chrome://newtab/'),
  ];
  const plan = planRestore(
    saved,
    [
      windowTab(TABVERSE_TAB_ID),
      windowTab(8, 'chrome://newtab/'),
      windowTab(9, 'chrome://newtab/'),
    ],
    TABVERSE_TAB_ID,
  );

  // two open tabs stand for two saved tabs, the third has to be opened
  expect(plan.entries.map((entry) => entry.reuseChromeTabId)).toEqual([
    8,
    9,
    undefined,
  ]);
  expect(plan.createTabs.length).toBe(1);
});

test('the same url twice open, and once saved, reuses one of them', () => {
  const saved = [savedTab('New tab', 'chrome://newtab/')];
  const plan = planRestore(
    saved,
    [windowTab(8, 'chrome://newtab/'), windowTab(9, 'chrome://newtab/')],
    TABVERSE_TAB_ID,
  );

  // one open tab stands for the saved one, and the other is the user's window:
  // the plan leaves it alone rather than closing a tab it does not own
  expect(plan.entries[0].reuseChromeTabId).toBe(8);
});

test('the saved pinned state travels with the plan', () => {
  const saved = [
    savedTab('Pinned', 'https://a.test/', true),
    savedTab('Loose', 'https://b.test/'),
  ];
  const plan = planRestore(
    saved,
    [windowTab(7, 'https://a.test/')],
    TABVERSE_TAB_ID,
  );

  expect(plan.entries.map((entry) => entry.pinned)).toEqual([true, false]);
});

test('a tab without an id cannot be reused or moved', () => {
  const saved = [savedTab('A', 'https://a.test/')];
  const plan = planRestore(
    saved,
    [{ url: 'https://a.test/' }],
    TABVERSE_TAB_ID,
  );

  expect(plan.createTabs).toEqual(saved);
});
