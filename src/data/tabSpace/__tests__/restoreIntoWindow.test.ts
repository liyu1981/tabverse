import { TabSpace, insertTab, newEmptyTabSpace } from '../TabSpace';
import { $tabSpace } from '../store';
import { entryTabs, tabverseEntries } from '../tabEntries';
import { getMockChrome } from '../../../dev/chromeMock';
import { getNewId } from '../../common';
import { loadTabSpaceByTabSpaceId, saveTabSpace } from '../util';
import { resetTestDb } from '../../../dev/dbImplTest';
import { setPinned, setTitle, setUrl, newEmptyTab } from '../Tab';

const MANAGER_URL = 'chrome-extension://abcdefgh/manager.html?op=new&tvid=ts-1';

/** A saved tabverse: a name and the urls of its tabs, in order. */
async function savedTabSpace(
  name: string,
  tabs: { title: string; url: string; pinned?: boolean }[],
): Promise<TabSpace> {
  let tabSpace: TabSpace = newEmptyTabSpace();
  tabSpace = { ...tabSpace, id: getNewId(), name };
  for (const { title, url, pinned } of tabs) {
    let tab = setUrl(url, setTitle(title, newEmptyTab()));
    if (pinned) {
      tab = setPinned(true, tab);
    }
    tabSpace = insertTab({ tab }, tabSpace);
  }
  await saveTabSpace(tabSpace);
  return tabSpace;
}

/** The window as chrome reports it, in tab strip order. */
async function windowUrls(
  mockChrome: ReturnType<typeof getMockChrome>,
): Promise<string[]> {
  const tabs = await chrome.tabs.query({
    windowId: mockChrome.currentWindowId,
  });
  return tabs.map((tab) => tab.url);
}

let mockChrome: ReturnType<typeof getMockChrome>;

beforeEach(async () => {
  await resetTestDb();
  mockChrome = getMockChrome();
});

test('a tab of the tabverse that is already open here is not opened again', async () => {
  const tabSpace = await savedTabSpace('work', [
    { title: 'Docs', url: 'https://example.com/docs' },
    { title: 'Search', url: 'https://example.com/search' },
  ]);

  const w = mockChrome.addWindow();
  const manager = mockChrome.insertTabFromData(
    { title: 'Tabverse', url: MANAGER_URL, favIconUrl: '', pinned: true },
    w.id,
  );
  // the user already has the docs open in this window, in a tab of their own
  const alreadyOpen = mockChrome.insertTabFromData(
    {
      title: 'Docs',
      url: 'https://example.com/docs',
      favIconUrl: '',
      pinned: false,
    },
    w.id,
  );
  // ... and a tab that is not part of the tabverse
  mockChrome.insertTabFromData(
    {
      title: 'Elsewhere',
      url: 'https://elsewhere.test/',
      favIconUrl: '',
      pinned: false,
    },
    w.id,
  );

  await loadTabSpaceByTabSpaceId(tabSpace.id, manager.id, w.id);

  // the docs tab is the one that was there, not a copy of it
  const tabs = await chrome.tabs.query({ windowId: w.id });
  expect(
    tabs.filter((tab) => tab.url === 'https://example.com/docs'),
  ).toHaveLength(1);
  expect(tabs.find((tab) => tab.url === 'https://example.com/docs').id).toBe(
    alreadyOpen.id,
  );
  // the tab that was not part of the tabverse is gone
  expect(tabs.map((tab) => tab.url)).not.toContain('https://elsewhere.test/');

  // and the store knows the live tab of each entry, so the list's buttons work
  const live = $tabSpace.getState();
  expect(live.name).toBe('work');
  expect(live.tabs.map((tab) => tab.title).toArray()).toEqual([
    'Docs',
    'Search',
  ]);
  const docs = live.tabs.find((tab) => tab.title === 'Docs');
  expect(docs.chromeTabId).toBe(alreadyOpen.id);
  expect(docs.chromeWindowId).toBe(w.id);
  expect(
    live.tabs.find((tab) => tab.title === 'Search').chromeTabId,
  ).toBeGreaterThan(0);
});

test('the window a split view is already open in comes back as a split', async () => {
  const tabSpace = await savedTabSpace('work', [
    { title: 'Docs', url: 'https://example.com/docs' },
    { title: 'Search', url: 'https://example.com/search' },
  ]);
  const w = mockChrome.addWindow();
  const manager = mockChrome.insertTabFromData(
    { title: 'Tabverse', url: MANAGER_URL, favIconUrl: '', pinned: true },
    w.id,
  );
  // the user has both of the tabverse's tabs open here, side by side in a
  // split view - a split the restore keeps (it reopens neither tab) but, with
  // no write path for splits, could never put back
  mockChrome.insertTabFromData(
    {
      title: 'Docs',
      url: 'https://example.com/docs',
      favIconUrl: '',
      pinned: false,
      splitViewId: 77,
    },
    w.id,
  );
  mockChrome.insertTabFromData(
    {
      title: 'Search',
      url: 'https://example.com/search',
      favIconUrl: '',
      pinned: false,
      splitViewId: 77,
    },
    w.id,
  );

  await loadTabSpaceByTabSpaceId(tabSpace.id, manager.id, w.id);

  // so the read-back at the end of the restore has to bring the split with it
  const live = $tabSpace.getState();
  expect(live.tabs.map((tab) => tab.splitViewId).toArray()).toEqual([77, 77]);
  // and the list draws it as one split block, not two rows
  const entries = tabverseEntries(live);
  expect(entries.map((entry) => entry.kind)).toEqual(['split']);
  expect(entryTabs(entries[0]).map((tab) => tab.url)).toEqual([
    'https://example.com/docs',
    'https://example.com/search',
  ]);
});

test('a tab the window has unsplit is not left split in the tabverse', async () => {
  const tabSpace = await savedTabSpace('work', [
    { title: 'Docs', url: 'https://example.com/docs' },
    { title: 'Search', url: 'https://example.com/search' },
  ]);
  const w = mockChrome.addWindow();
  const manager = mockChrome.insertTabFromData(
    { title: 'Tabverse', url: MANAGER_URL, favIconUrl: '', pinned: true },
    w.id,
  );
  // both open here, but only one of them is in a split view
  mockChrome.insertTabFromData(
    {
      title: 'Docs',
      url: 'https://example.com/docs',
      favIconUrl: '',
      pinned: false,
      splitViewId: 77,
    },
    w.id,
  );
  mockChrome.insertTabFromData(
    {
      title: 'Search',
      url: 'https://example.com/search',
      favIconUrl: '',
      pinned: false,
      // chrome says "not in a split" as a value, not as an absent field
      splitViewId: mockChrome.tabs.SPLIT_VIEW_ID_NONE,
    },
    w.id,
  );

  await loadTabSpaceByTabSpaceId(tabSpace.id, manager.id, w.id);

  // a partner that is not there is not a split: two plain rows
  expect(tabverseEntries($tabSpace.getState()).map((e) => e.kind)).toEqual([
    'tab',
    'tab',
  ]);
});

test('the tab the window has open wins over the row the tabverse saved', async () => {
  const tabSpace = await savedTabSpace('work', [
    { title: 'Docs', url: 'https://example.com/docs' },
  ]);
  const w = mockChrome.addWindow();
  const manager = mockChrome.insertTabFromData(
    { title: 'Tabverse', url: MANAGER_URL, favIconUrl: '', pinned: true },
    w.id,
  );
  // the same page, but it has moved on since the tabverse was saved
  const open = mockChrome.insertTabFromData(
    {
      title: 'Docs - Example',
      url: 'https://example.com/docs',
      favIconUrl: 'https://example.com/favicon.ico',
      pinned: true,
    },
    w.id,
  );

  await loadTabSpaceByTabSpaceId(tabSpace.id, manager.id, w.id);

  const docs = $tabSpace.getState().tabs.first();
  expect(docs.chromeTabId).toBe(open.id);
  expect(docs.title).toBe('Docs - Example');
  expect(docs.favIconUrl).toBe('https://example.com/favicon.ico');
  // pinned is the one field the tabverse owns, so the saved row still wins
  expect(docs.pinned).toBe(false);
});

test('a tab the tabverse did not save is still opened', async () => {
  const tabSpace = await savedTabSpace('work', [
    { title: 'A', url: 'https://a.test/' },
    { title: 'B', url: 'https://b.test/' },
  ]);
  const w = mockChrome.addWindow();
  const manager = mockChrome.insertTabFromData(
    { title: 'Tabverse', url: MANAGER_URL, favIconUrl: '', pinned: true },
    w.id,
  );
  mockChrome.insertTabFromData(
    { title: 'B', url: 'https://b.test/', favIconUrl: '', pinned: false },
    w.id,
  );

  await loadTabSpaceByTabSpaceId(tabSpace.id, manager.id, w.id);

  expect(await windowUrls(mockChrome)).toEqual([
    MANAGER_URL,
    'https://a.test/',
    'https://b.test/',
  ]);
});

test('the tab strip ends up in the tabverse order, tabverse tab first', async () => {
  const tabSpace = await savedTabSpace('work', [
    { title: 'One', url: 'https://one.test/' },
    { title: 'Two', url: 'https://two.test/' },
    { title: 'Three', url: 'https://three.test/' },
  ]);
  const w = mockChrome.addWindow();
  const manager = mockChrome.insertTabFromData(
    { title: 'Tabverse', url: MANAGER_URL, favIconUrl: '', pinned: true },
    w.id,
  );
  // everything the user had open is in the wrong place, and "Three" is
  // already open here while "One" is not
  const three = mockChrome.insertTabFromData(
    {
      title: 'Three',
      url: 'https://three.test/',
      favIconUrl: '',
      pinned: false,
    },
    w.id,
  );
  mockChrome.insertTabFromData(
    { title: 'Two', url: 'https://two.test/', favIconUrl: '', pinned: false },
    w.id,
  );
  mockChrome.insertTabFromData(
    {
      title: 'Extra',
      url: 'https://extra.test/',
      favIconUrl: '',
      pinned: false,
    },
    w.id,
  );

  await loadTabSpaceByTabSpaceId(tabSpace.id, manager.id, w.id);

  // "One" was opened at the end and "Three" was reused where it was, so the
  // order the user sees only matches the tabverse if the restore puts it back
  expect(await windowUrls(mockChrome)).toEqual([
    MANAGER_URL,
    'https://one.test/',
    'https://two.test/',
    'https://three.test/',
  ]);
  const tabs = await chrome.tabs.query({ windowId: w.id });
  // "Three" was reused, so it is the tab that was there
  expect(tabs.find((tab) => tab.url === 'https://three.test/').id).toBe(
    three.id,
  );
  expect(tabs[0].id).toBe(manager.id);
});

test('a pinned tab of the tabverse is pinned, in front of the loose ones', async () => {
  const tabSpace = await savedTabSpace('work', [
    { title: 'One', url: 'https://one.test/' },
    { title: 'Two', url: 'https://two.test/', pinned: true },
  ]);
  const w = mockChrome.addWindow();
  const manager = mockChrome.insertTabFromData(
    { title: 'Tabverse', url: MANAGER_URL, favIconUrl: '', pinned: true },
    w.id,
  );
  mockChrome.insertTabFromData(
    { title: 'One', url: 'https://one.test/', favIconUrl: '', pinned: false },
    w.id,
  );

  await loadTabSpaceByTabSpaceId(tabSpace.id, manager.id, w.id);

  // Chrome keeps the pinned section in front of the loose tabs, and the
  // restore asks for the saved order inside each of the two - the mock has no
  // pinned section, so "pinned first" is all it can show of it
  expect(await windowUrls(mockChrome)).toEqual([
    MANAGER_URL,
    'https://two.test/',
    'https://one.test/',
  ]);
  const tabs = await chrome.tabs.query({ windowId: w.id });
  expect(tabs.map((tab) => !!tab.pinned)).toEqual([true, true, false]);
});

test('the saved pinned state wins over what the window had', async () => {
  const tabSpace = await savedTabSpace('work', [
    { title: 'Pinned in the tabverse', url: 'https://p.test/', pinned: true },
    { title: 'Loose in the tabverse', url: 'https://l.test/' },
  ]);
  const w = mockChrome.addWindow();
  const manager = mockChrome.insertTabFromData(
    { title: 'Tabverse', url: MANAGER_URL, favIconUrl: '', pinned: true },
    w.id,
  );
  // pinned here, saved unpinned: it comes back unpinned
  mockChrome.insertTabFromData(
    {
      title: 'Loose in the tabverse',
      url: 'https://l.test/',
      favIconUrl: '',
      pinned: true,
    },
    w.id,
  );

  await loadTabSpaceByTabSpaceId(tabSpace.id, manager.id, w.id);

  const tabs = await chrome.tabs.query({ windowId: w.id });
  const byUrl = new Map(tabs.map((tab) => [tab.url, tab]));
  expect(byUrl.get('https://l.test/').pinned).toBe(false);
  expect(byUrl.get('https://p.test/').pinned).toBe(true);
  // and the store agrees with the window
  expect(
    $tabSpace
      .getState()
      .tabs.map((tab) => tab.pinned)
      .toArray(),
  ).toEqual([true, false]);
});
