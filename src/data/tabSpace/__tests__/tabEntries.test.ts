import {
  TABSPACE_DB_TABLE_NAME,
  TabSpace,
  insertTab,
  newEmptyTabSpace,
} from '../TabSpace';
import { TAB_DB_TABLE_NAME } from '../Tab';
import { db } from '../../../storage/db';
import { newEmptyTab, setPinned, setTitle, setUrl } from '../Tab';
import { querySavedTabSpace, saveTabSpace } from '../util';
import { resetTestDb } from '../../../dev/dbImplTest';
import { tabverseEntries } from '../tabEntries';
import { produce } from 'immer';

import { Tab } from '../Tab';
import { getNewId, getSavedId } from '../../common';

/** A tabverse with a pinned tab, a split pair and a named group. */
function tabverseWithEverything(): {
  tabSpace: TabSpace;
  named: Record<string, Tab>;
} {
  const id = getNewId();
  const pinned = setPinned(
    true,
    setUrl('https://a.com', setTitle('Pinned', newEmptyTab())),
  );
  const left = {
    ...setUrl('https://b.com', setTitle('Left', newEmptyTab())),
    splitViewId: 7,
  };
  const right = {
    ...setUrl('https://c.com', setTitle('Right', newEmptyTab())),
    splitViewId: 7,
  };
  const grouped = setUrl('https://d.com', setTitle('Grouped', newEmptyTab()));
  const loose = setUrl('https://e.com', setTitle('Loose', newEmptyTab()));

  let tabSpace: TabSpace = newEmptyTabSpace();
  tabSpace = { ...tabSpace, id, name: 'everything' };
  [pinned, left, right, grouped, loose].forEach((tab) => {
    tabSpace = insertTab({ tab }, tabSpace);
  });
  tabSpace = produce(tabSpace, (draft) => {
    draft.tabGroups = [
      { id: 'g1', title: 'Work', color: 'blue', tabIds: [grouped.id] },
    ];
  });
  return { tabSpace, named: { pinned, left, right, grouped, loose } };
}

const describeEntries = (tabSpace: TabSpace) =>
  tabverseEntries(tabSpace).map((entry) =>
    entry.kind === 'tab'
      ? `tab:${entry.tab.title}`
      : entry.kind === 'split'
        ? `split:${entry.tabs.map((t) => t.title).join('+')}`
        : `group:${entry.group.title}(${entry.tabs.length})`,
  );

beforeEach(async () => {
  await resetTestDb();
});

test('pinned and tab groups survive a save and load', async () => {
  // the question this file exists for: are these saved at all? yes. A pinned
  // tab is `pinned: true` on its SavedTab row; a group is a hint on the
  // tabverse row carrying *our* group id, title, colour and tab ids, because
  // Chrome's group ids are unique per session and cannot be stored.
  const { tabSpace, named } = tabverseWithEverything();
  await saveTabSpace(tabSpace);

  const tabRow = (await db.table(TAB_DB_TABLE_NAME).toArray()).find(
    (row) => row.title === 'Pinned',
  );
  expect(tabRow.pinned).toBe(true);

  const tabSpaceRow = await db.table(TABSPACE_DB_TABLE_NAME).get(tabSpace.id);
  // saving strips the leading ~ from a new tab's id, and the group hints are
  // remapped to follow, or the group would point at tabs that no longer exist
  expect(tabSpaceRow.tabGroups).toEqual([
    {
      id: 'g1',
      title: 'Work',
      color: 'blue',
      tabIds: [getSavedId(named.grouped.id)],
    },
  ]);

  const [loaded] = await querySavedTabSpace({ anyOf: [tabSpace.id] });
  expect(loaded.tabs.find((t) => t.title === 'Pinned').pinned).toBe(true);
  expect(loaded.tabs.find((t) => t.title === 'Loose').pinned).toBe(false);
  expect(loaded.tabGroups.length).toEqual(1);
  expect(loaded.tabGroups[0].title).toEqual('Work');
  expect(loaded.tabGroups[0].color).toEqual('blue');
});

test('a loaded tabverse reads as its groups and plain tabs', () => {
  const { tabSpace } = tabverseWithEverything();
  // a split view is session scoped, like chromeTabId: it is not saved, so the
  // saved list can only ever show groups and single tabs
  // a group appears where its first tab is, not in a block of its own
  expect(describeEntries(tabSpace)).toEqual([
    'tab:Pinned',
    'split:Left+Right',
    'group:Work(1)',
    'tab:Loose',
  ]);

  const withoutSplit = produce(tabSpace, (draft) => {
    draft.tabs = draft.tabs.map((t) => ({ ...t, splitViewId: undefined }));
  });
  expect(describeEntries(withoutSplit)).toEqual([
    'tab:Pinned',
    'tab:Left',
    'tab:Right',
    'group:Work(1)',
    'tab:Loose',
  ]);
});

test('a group whose tabs are all gone still shows up', () => {
  const { tabSpace } = tabverseWithEverything();
  const emptied = produce(tabSpace, (draft) => {
    draft.tabGroups = [
      { id: 'g1', title: 'Work', color: 'blue', tabIds: ['no-such-tab'] },
    ];
  });

  const group = tabverseEntries(emptied).find(
    (entry) => entry.kind === 'group',
  );
  expect(group).toBeTruthy();
  expect(group.tabs).toEqual([]);
});

test('a tabverse with no groups and no splits is a flat list', () => {
  let tabSpace: TabSpace = newEmptyTabSpace();
  tabSpace = { ...tabSpace, id: getNewId(), name: 'flat' };
  tabSpace = insertTab(
    { tab: setUrl('https://a.com', setTitle('A', newEmptyTab())) },
    tabSpace,
  );
  tabSpace = insertTab(
    { tab: setUrl('https://b.com', setTitle('B', newEmptyTab())) },
    tabSpace,
  );

  const entries = tabverseEntries(tabSpace);
  expect(entries.length).toEqual(2);
  expect(entries.every((entry) => entry.kind === 'tab')).toBe(true);
});
