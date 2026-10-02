import {
  addClosedTab,
  allClosedTabFromRows,
  clearClosedTabs,
  convertAndGetClosedTabSavePayloads,
  newEmptyAllClosedTab,
  removeClosedTab,
  sortByClosedAt,
  updateClosedTab,
  updateTabSpaceId,
} from '../AllClosedTab';
import { List } from 'immutable';

import {
  HISTORY_MAX_ENTRIES,
  newClosedTabFromTab,
  newEmptyClosedTab,
  setTitle,
  setUrl,
} from '../ClosedTab';
import { TabCore } from '../../tabSpace/Tab';

function newTab(url: string, title = url): TabCore {
  return {
    version: 9,
    id: 'someTabId',
    createdAt: 1,
    updatedAt: 1,
    tabSpaceId: 'whatever',
    title,
    url,
    favIconUrl: `${url}/icon`,
    pinned: false,
    suspended: false,
  };
}

function initAllClosedTab() {
  const tabSpaceId = 'hello';
  let allClosedTab = updateTabSpaceId(tabSpaceId, newEmptyAllClosedTab());
  const c1 = setUrl('https://www.test1.com', newEmptyClosedTab());
  const c2 = setUrl('https://www.test2.com', newEmptyClosedTab());
  allClosedTab = addClosedTab(c1, allClosedTab);
  allClosedTab = addClosedTab(c2, allClosedTab);
  return { tabSpaceId, allClosedTab, c1, c2 };
}

test('init & addClosedTab', () => {
  const { tabSpaceId, allClosedTab, c1, c2 } = initAllClosedTab();

  expect(allClosedTab.closedTabs.size).toEqual(2);
  expect(allClosedTab.tabSpaceId).toEqual(tabSpaceId);
  allClosedTab.closedTabs.forEach((t) => {
    expect(t.tabSpaceId).toEqual(tabSpaceId);
  });
  expect(allClosedTab.closedTabs.find((t) => t.id === c1.id)).toBeTruthy();
  expect(allClosedTab.closedTabs.find((t) => t.id === c2.id)).toBeTruthy();
});

test('the newest closed tab is first', () => {
  const entry = (url: string, closedAt: number) => ({
    ...setUrl(url, newEmptyClosedTab()),
    closedAt,
  });
  const base = updateTabSpaceId('ts', newEmptyAllClosedTab());
  const withMiddle = addClosedTab(entry('https://www.test2.com', 3000), base);
  const withOlder = addClosedTab(
    entry('https://www.test0.com', 1000),
    withMiddle,
  );
  const withNewer = addClosedTab(
    entry('https://www.test3.com', 5000),
    withOlder,
  );

  expect(withNewer.closedTabs.map((t) => t.url).toArray()).toEqual([
    'https://www.test3.com',
    'https://www.test2.com',
    'https://www.test0.com',
  ]);
});

test('closing the same url again bumps the entry instead of adding one', () => {
  const { allClosedTab, c1 } = initAllClosedTab();
  const before = allClosedTab.closedTabs.find((t) => t.id === c1.id);
  expect(before.timesClosed).toEqual(1);

  const again = setTitle(
    'a better title',
    setUrl('https://www.test1.com', newEmptyClosedTab()),
  );
  const after = addClosedTab(
    { ...again, closedAt: before.closedAt + 1000 },
    allClosedTab,
  );

  expect(after.closedTabs.size).toEqual(2);
  const entry = after.closedTabs.find((t) => t.id === c1.id);
  // same row, later close time, counted twice, newest title wins
  expect(entry.timesClosed).toEqual(2);
  expect(entry.closedAt).toEqual(before.closedAt + 1000);
  expect(entry.title).toEqual('a better title');
  expect(after.closedTabs.first().id).toEqual(c1.id);
});

test('a close older than the stored one never moves an entry backwards', () => {
  const { allClosedTab, c1 } = initAllClosedTab();
  const stored = allClosedTab.closedTabs.find((t) => t.id === c1.id);
  const after = addClosedTab(
    {
      ...setUrl(stored.url, newEmptyClosedTab()),
      closedAt: stored.closedAt - 5000,
    },
    allClosedTab,
  );
  expect(after.closedTabs.find((t) => t.id === c1.id).closedAt).toEqual(
    stored.closedAt,
  );
});

test('the list is capped, the oldest entries fall off', () => {
  let allClosedTab = updateTabSpaceId('ts', newEmptyAllClosedTab());
  for (let i = 0; i < HISTORY_MAX_ENTRIES + 5; i += 1) {
    allClosedTab = addClosedTab(
      {
        ...setUrl(`https://www.test${i}.com`, newEmptyClosedTab()),
        closedAt: 1000 + i,
      },
      allClosedTab,
    );
  }
  expect(allClosedTab.closedTabs.size).toEqual(HISTORY_MAX_ENTRIES);
  // the five oldest are gone, the newest one is on top
  expect(allClosedTab.closedTabs.first().url).toEqual(
    `https://www.test${HISTORY_MAX_ENTRIES + 4}.com`,
  );
  expect(
    allClosedTab.closedTabs.find((t) => t.url === 'https://www.test0.com'),
  ).toBe(undefined);
});

test('updateClosedTab / removeClosedTab / clearClosedTabs', () => {
  const { allClosedTab, c1, c2 } = initAllClosedTab();

  const updated = updateClosedTab(c1.id, { title: 'renamed' }, allClosedTab);
  expect(updated.closedTabs.find((t) => t.id === c1.id).title).toEqual(
    'renamed',
  );
  expect(updateClosedTab('no-such-id', { title: 'x' }, updated)).toEqual(
    updated,
  );

  const removed = removeClosedTab(c1.id, updated);
  expect(removed.closedTabs.size).toEqual(1);
  expect(removed.closedTabs.first().id).toEqual(c2.id);

  expect(clearClosedTabs(removed).closedTabs.size).toEqual(0);
});

test('updateTabSpaceId re-parents every entry', () => {
  const { allClosedTab } = initAllClosedTab();
  const moved = updateTabSpaceId('another', allClosedTab);
  expect(moved.tabSpaceId).toEqual('another');
  moved.closedTabs.forEach((t) => {
    expect(t.tabSpaceId).toEqual('another');
  });
});

test('allClosedTabFromRows keeps the newest rows only', () => {
  const rows = [3000, 1000, 2000].map((closedAt) => ({
    ...newEmptyClosedTab(),
    id: `entry-${closedAt}`,
    url: `https://www.test${closedAt}.com`,
    closedAt,
  }));
  const allClosedTab = allClosedTabFromRows('ts', rows);
  expect(allClosedTab.closedTabs.map((t) => t.closedAt).toArray()).toEqual([
    3000, 2000, 1000,
  ]);
  expect(allClosedTab.tabSpaceId).toEqual('ts');
});

test('sortByClosedAt breaks a tie with the creation time', () => {
  const older = { ...newEmptyClosedTab(), id: 'a', closedAt: 10, createdAt: 1 };
  const newer = { ...newEmptyClosedTab(), id: 'b', closedAt: 10, createdAt: 2 };
  expect(
    sortByClosedAt(List([older, newer]))
      .map((t) => t.id)
      .toArray(),
  ).toEqual(['b', 'a']);
});

test('convertAndGetClosedTabSavePayloads keeps the ids it is given', () => {
  const { allClosedTab, c1, c2 } = initAllClosedTab();
  const { allClosedTab: saved, closedTabSavePayloads } =
    convertAndGetClosedTabSavePayloads(allClosedTab);

  expect(closedTabSavePayloads.length).toEqual(2);
  // ids are final from creation, so a save stamps the times and nothing else
  expect(
    saved.closedTabs
      .map((t) => t.id)
      .toArray()
      .sort(),
  ).toEqual([c1.id, c2.id].sort());
  expect(closedTabSavePayloads.map((p) => p.id).sort()).toEqual(
    [c1.id, c2.id].sort(),
  );

  // and a second pass is the same two rows
  const second = convertAndGetClosedTabSavePayloads(saved);
  expect(second.closedTabSavePayloads.length).toEqual(2);
});

test('newClosedTabFromTab takes the url, title and icon of the tab', () => {
  const closedTab = newClosedTabFromTab(
    newTab('https://www.test1.com', 'a title'),
    'ts',
    12345,
  );
  expect(closedTab.url).toEqual('https://www.test1.com');
  expect(closedTab.title).toEqual('a title');
  expect(closedTab.favIconUrl).toEqual('https://www.test1.com/icon');
  expect(closedTab.tabSpaceId).toEqual('ts');
  expect(closedTab.closedAt).toEqual(12345);
  expect(closedTab.timesClosed).toEqual(1);
  // live tab fields stay out of the history row
  expect((closedTab as any).chromeTabId).toBeUndefined();
});
