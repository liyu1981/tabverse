/**
 * A split view opened *inside* a tab group.
 *
 * Reported as: a group "github" with tab1 and tab2, then a split of tab1 with a
 * new tab3 - and the tabverse kept showing `github: tab1, tab2`, with neither
 * tab3 nor the split. Three separate things had to be right for that to work,
 * and each is pinned here: the capture of both halves, the hint that says tab3
 * is in the group, and the entry builder that takes a group and stops (which is
 * why the split could not be drawn).
 */
import { $tabSpace, tabSpaceStoreApi } from '../store';
import { setupMockChromeAndTabSpaceWithMonitoring } from './common.test';
import { tabverseEntries } from '../tabEntries';
import { findTabById, findTabByChromeTabId } from '../TabSpace';
import { Tab } from '../Tab';
import { getNewId } from '../../common';

const splitId = 7;
const groupId = 42;

function read(tabSpace = $tabSpace.getState()) {
  return tabverseEntries(tabSpace).map((entry) =>
    entry.kind === 'group'
      ? `group:${entry.group.title}[${entry.tabs
          .map((t) => t.title)
          .join(',')}]`
      : entry.kind === 'split'
        ? `split[${entry.tabs.map((t) => t.title).join('|')}]`
        : `tab:${entry.tab.title}`,
  );
}

/** A chrome tabGroups that says one group exists: `github`, id 42. */
function installFakeTabGroups() {
  (globalThis as any).chrome.tabGroups = {
    query: async () => [{ id: groupId, title: 'github', color: 'blue' }],
    onCreated: { addListener: () => undefined },
    onUpdated: { addListener: () => undefined },
    onRemoved: { addListener: () => undefined },
    onMoved: { addListener: () => undefined },
  };
}

afterEach(() => {
  delete (globalThis as any).chrome.tabGroups;
});

test('both halves of the split are captured', async () => {
  const { mockChrome, w1, t1 } =
    await setupMockChromeAndTabSpaceWithMonitoring();

  mockChrome.updateTab(t1.id, { splitViewId: splitId, title: 'tab1' });
  const created = mockChrome.insertTabFromData(
    {
      title: 'tab3',
      url: 'https://example.com/3',
      favIconUrl: '',
      pinned: false,
      splitViewId: splitId,
    },
    w1.id,
  );
  // the update path is debounced by 500ms, so this waits past it
  await mockChrome.flushMessages(900);

  const state = $tabSpace.getState();
  const ours = findTabByChromeTabId(t1.id, state) as Tab;
  const theirs = state.tabs.find((tab) => tab.chromeTabId === created.id);
  expect(findTabById(ours.id, state)?.splitViewId).toEqual(splitId);
  expect(theirs?.splitViewId).toEqual(splitId);
  expect(theirs?.title).toEqual('tab3');
});

test('a split inside a group reads as one group holding the pair', async () => {
  const { mockChrome, w1, t1, t2 } =
    await setupMockChromeAndTabSpaceWithMonitoring();
  const ourTab1 = findTabByChromeTabId(t1.id, $tabSpace.getState()) as Tab;
  const ourTab2 = findTabByChromeTabId(t2.id, $tabSpace.getState()) as Tab;
  tabSpaceStoreApi.updateTab({ tid: ourTab2.id, changes: { title: 'tab2' } });

  const created = mockChrome.insertTabFromData(
    {
      title: 'tab3',
      url: 'https://example.com/3',
      favIconUrl: '',
      pinned: false,
      splitViewId: splitId,
    },
    w1.id,
  );
  mockChrome.updateTab(t1.id, { splitViewId: splitId, title: 'tab1' });
  await mockChrome.flushMessages(900);

  const ourTab3 = $tabSpace
    .getState()
    .tabs.find((tab) => tab.chromeTabId === created.id) as Tab;

  // Chrome put the new half in the group it split from, so the hint says so
  // (that is what captureGroupsOfWindow does in a real window - see the test
  // below for the case where the tab arrives already grouped)
  tabSpaceStoreApi.setTabGroups([
    {
      id: 'g-github',
      title: 'github',
      color: 'blue',
      tabIds: [ourTab1.id, ourTab3.id, ourTab2.id],
    },
  ]);

  const entries = read();
  // one entry for the group - and it holds all three tabs, which is exactly the
  // piece a view needs to draw the split inside it. `tab:new tab` is the
  // window's own third tab, not part of any group
  expect(entries).toEqual(['group:github[tab1,tab3,tab2]', 'tab:new tab']);
  // and the group carries the pair, so what draws it can find it
  const group = tabverseEntries($tabSpace.getState())[0];
  expect(group.kind).toEqual('group');
  expect(group.kind === 'group' ? group.tabs.map((t) => t.title) : []).toEqual([
    'tab1',
    'tab3',
    'tab2',
  ]);
  expect(group.kind === 'group' ? group.tabs.length : 0).toEqual(3);
});

test('a partner already inside the group is not drawn a second time', async () => {
  const { mockChrome, w1, t1, t2 } =
    await setupMockChromeAndTabSpaceWithMonitoring();
  const ourTab1 = findTabByChromeTabId(t1.id, $tabSpace.getState()) as Tab;
  const ourTab2 = findTabByChromeTabId(t2.id, $tabSpace.getState()) as Tab;
  tabSpaceStoreApi.updateTab({ tid: ourTab2.id, changes: { title: 'tab2' } });

  const created = mockChrome.insertTabFromData(
    {
      title: 'tab3',
      url: 'https://example.com/3',
      favIconUrl: '',
      pinned: false,
      splitViewId: splitId,
    },
    w1.id,
  );
  mockChrome.updateTab(t1.id, { splitViewId: splitId, title: 'tab1' });
  await mockChrome.flushMessages(900);

  // the case where tab3 did *not* join the group: its partner is inside the
  // group above it, and drawing the pair again would show tab1 twice
  tabSpaceStoreApi.setTabGroups([
    {
      id: 'g-github',
      title: 'github',
      color: 'blue',
      tabIds: [ourTab1.id, ourTab2.id],
    },
  ]);

  expect(read()).toEqual([
    'group:github[tab1,tab2]',
    'tab:new tab',
    'tab:tab3',
  ]);
  expect(created.id).toBeGreaterThan(0);
});

test('a tab that arrives already grouped joins the hint', async () => {
  // `changeInfo.groupId` only fires when a tab moves in or out of an existing
  // group; a tab *created* inside one carries `groupId` and says nothing else.
  // Installed after the setup call: that is what assigns global chrome.
  const { mockChrome, w1, t1 } =
    await setupMockChromeAndTabSpaceWithMonitoring();
  installFakeTabGroups();
  const ourTab1 = findTabByChromeTabId(t1.id, $tabSpace.getState()) as Tab;
  mockChrome.updateTab(t1.id, { groupId });

  const created = mockChrome.insertTabFromData(
    {
      title: 'tab3',
      url: 'https://example.com/3',
      favIconUrl: '',
      pinned: false,
      groupId,
    },
    w1.id,
  );
  await mockChrome.flushMessages(900);

  const hint = $tabSpace.getState().tabGroups;
  const ours = $tabSpace
    .getState()
    .tabs.find((tab) => tab.chromeTabId === created.id) as Tab;
  expect(hint.length).toEqual(1);
  expect(hint[0].title).toEqual('github');
  // both the tab that moved in and the one born inside are in it
  expect(hint[0].tabIds).toContain(ourTab1.id);
  expect(hint[0].tabIds).toContain(ours.id);
});
