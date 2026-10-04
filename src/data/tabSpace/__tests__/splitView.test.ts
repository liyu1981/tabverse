/**
 * The periodic re-read that retires a closed split view (ADR 0022).
 *
 * Reported as a wart: a split the user closed kept drawing, because "chrome
 * reports no split" and "chrome has no opinion" were the same absence and only
 * the second one could be believed. Chrome does distinguish them - the property
 * carries `SPLIT_VIEW_ID_NONE` when it has an answer - so the rescan goes and
 * asks again instead of trusting that it heard the first time.
 */
import { List } from 'immutable';

import { $tabSpace, tabSpaceStoreApi } from '../store';
import { setupMockChromeAndTabSpaceWithMonitoring } from './common.test';
import { refreshSplitViews } from '../splitView';
import { scanCurrentTabs } from '../chromeTab';
import { insertTab } from '../TabSpace';
import {
  SPLIT_VIEW_ID_NONE,
  Tab,
  findSplitPartnerByChromeId,
  newEmptyTab,
  setTitle,
} from '../Tab';
import { getNewId } from '../../common';

/**
 * Two tabs, given to both Chrome and the store by hand so the test is about the
 * rescan and not about the event path: `notify: false` on the chrome tabs stops
 * `onCreated` from adding rows of its own, and the store's rows are what a
 * tabverse saved while split looks like - a live id *and* the pairing.
 *
 * `chromeSplit` is what Chrome says about them: a split id, or undefined for a
 * browser that has no opinion.
 */
async function withTwoTabs(opts: {
  chromeSplit: number | undefined;
  storeSplit: number | undefined;
}) {
  const { chromeSplit, storeSplit } = opts;
  const { mockChrome, w1, tst1 } =
    await setupMockChromeAndTabSpaceWithMonitoring();
  // A clean tabverse per test. The shared helper only patches the window ids, so
  // rows from the previous test are still in this store - carrying chrome tab
  // ids that now point at *this* mock's tabs, which the scan would then compare
  // and find different. Module state, so it has to be reset explicitly.
  tabSpaceStoreApi.reset({
    chromeTabId: tst1.id,
    chromeWindowId: tst1.windowId,
  });
  await scanCurrentTabs();
  const data = (title: string) => ({
    title,
    url: `https://${title}.example`,
    favIconUrl: '',
    pinned: false,
    splitViewId: chromeSplit,
  });
  const left = mockChrome.insertTabFromData(data('left'), w1.id, 0, false);
  const right = mockChrome.insertTabFromData(data('right'), w1.id, 1, false);
  const row = (id: string, title: string, partner: string): Tab => ({
    ...setTitle(title, newEmptyTab()),
    id,
    tabSpaceId: $tabSpace.getState().id,
    chromeTabId: id === 's1' ? left.id : right.id,
    chromeWindowId: w1.id,
    splitViewId: storeSplit,
    splitWith: partner,
  });
  tabSpaceStoreApi.update(
    insertTab(
      { tab: row('s1', 'left', 's2') },
      insertTab({ tab: row('s2', 'right', 's1') }, $tabSpace.getState()),
    ),
  );
  return { mockChrome, leftId: left.id, rightId: right.id };
}

test('chrome saying "not in a split" retires the pairing', async () => {
  const { mockChrome, leftId, rightId } = await withTwoTabs({
    chromeSplit: 7,
    storeSplit: 7,
  });

  // The user closes the split view. Chrome's answer for both tabs is the value
  // that means "no split", and it is a value rather than an absence.
  mockChrome.updateTab(leftId, { splitViewId: SPLIT_VIEW_ID_NONE });
  mockChrome.updateTab(rightId, { splitViewId: SPLIT_VIEW_ID_NONE });

  expect(await refreshSplitViews()).toBe(2);
  const tabs = $tabSpace.getState().tabs;
  expect(tabs.size).toBeGreaterThanOrEqual(2);
  const left = tabs.find((tab) => tab.id === 's1');
  const right = tabs.find((tab) => tab.id === 's2');
  expect(left?.splitViewId).toBe(SPLIT_VIEW_ID_NONE);
  expect(right?.splitViewId).toBe(SPLIT_VIEW_ID_NONE);
  // The pairing is what the save reads, and it is now contradicted by Chrome;
  // `withSplitPartners` is what drops it on the next save (TabSpace.test.ts).
  expect(left?.splitWith).toBe('s2');
});

test('a browser with no split view support leaves every pairing alone', async () => {
  // Chrome before 140 has no splitViewId at all, so the store's rows and Chrome's
  // tabs cannot be compared and nothing may be concluded from that. Believing the
  // silence would erase every pairing on every save.
  await withTwoTabs({ chromeSplit: undefined, storeSplit: undefined });
  expect(await refreshSplitViews()).toBe(0);
  const left = $tabSpace.getState().tabs.find((tab) => tab.id === 's1');
  expect(left?.splitViewId).toBeUndefined();
  expect(left?.splitWith).toBe('s2');
});

test('a scan with nothing to report changes nothing', async () => {
  await withTwoTabs({ chromeSplit: 7, storeSplit: 7 });
  // Already correct: no write and no churn, so no save is pulled in behind it.
  expect(await refreshSplitViews()).toBe(0);
  expect(
    $tabSpace.getState().tabs.find((tab) => tab.id === 's1')?.splitViewId,
  ).toBe(7);
});

test('a tab that is not in this window is never read', async () => {
  await withTwoTabs({ chromeSplit: 7, storeSplit: 7 });
  // The record a saved or restored tabverse keeps: no live tab, so Chrome has
  // nothing to say about it, and the pairing it carries has to survive.
  const stored = insertTab(
    {
      tab: {
        ...newEmptyTab(),
        id: getNewId(),
        title: 'stored',
        tabSpaceId: $tabSpace.getState().id,
        chromeTabId: -1,
        splitWith: 's1',
      },
    },
    $tabSpace.getState(),
  );
  tabSpaceStoreApi.update(stored);

  expect(await refreshSplitViews()).toBe(0);
  const after = $tabSpace.getState().tabs.find((tab) => tab.title === 'stored');
  expect(after?.splitViewId).toBeUndefined();
  expect(after?.splitWith).toBe('s1');
});

test('two tabs chrome says are both unsplit are not a pair', async () => {
  // The regression this whole path could introduce: the partner is found by
  // matching ids, and every unsplit tab in the window shares the same -1.
  const unsplit = [
    {
      ...setTitle('a', newEmptyTab()),
      id: 'a',
      splitViewId: SPLIT_VIEW_ID_NONE,
    },
    {
      ...setTitle('b', newEmptyTab()),
      id: 'b',
      splitViewId: SPLIT_VIEW_ID_NONE,
    },
  ] as Tab[];
  expect(
    findSplitPartnerByChromeId(unsplit[0], List<Tab>(unsplit)),
  ).toBeUndefined();
});
