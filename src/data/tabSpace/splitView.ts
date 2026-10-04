/**
 * The periodic re-read that retires a closed split view (ADR 0022).
 *
 * A split view is the one piece of layout that can end without the tabverse
 * changing shape: the user closes it in Chrome and both tabs stay exactly where
 * they are. The tab event path usually hears about it - `onUpdated` carries the
 * change and a changed split view id is not a metadata-only change, so it saves
 * - but "usually" is the whole problem. A tabverse page that was frozen or
 * suspended, a service worker asleep, an event coalesced away: nothing here
 * depends on having been listening, because it asks Chrome what is true now
 * rather than what it said once.
 *
 * So this is deliberately the narrowest scan in the extension: it reads the one
 * field, for the tabs that are in this window, and touches nothing else. A
 * general rescan would fight the event path over titles and favicons of tabs
 * that are still loading, which is the mistake `copyChromeTabFields` exists to
 * avoid.
 */

import { TabSpace, updateTab } from './TabSpace';
import { $tabSpace, tabSpaceStoreApi } from './store';
import { hasCapability } from '../../capabilities';
import { isTabSpaceManagerPage, logger } from '../../global';
import { saveCurrentTabSpace } from './util';

/**
 * How often the window is asked again.
 *
 * A minute is the floor Chrome imposes on timers in a hidden tab anyway, so this
 * costs a hidden tabverse one `tabs.query` a minute and nothing more, while an
 * open one converges inside that minute. The alternative - waiting for the event
 * that may never come - is the bug.
 */
export const SPLIT_RESCAN_INTERVAL_MS = 60_000;

/**
 * Re-reads every live tab's split state from Chrome and corrects the store,
 * returning how many tabs changed.
 *
 * A tab whose record says it was split and which Chrome now reports as
 * unsplit loses its pairing at the next save; a tab Chrome has no opinion about
 * is left exactly as it is.
 */
export async function refreshSplitViews(): Promise<number> {
  if (!hasCapability('splitViewRead')) {
    // A browser before 140 cannot answer, so asking would only produce the
    // silence that must not be believed.
    return 0;
  }
  const tabSpace = $tabSpace.getState();
  const windowId = tabSpace.chromeWindowId;
  if (windowId < 0) {
    return 0;
  }
  const live = tabSpace.tabs.filter((tab) => tab.chromeTabId > 0).toArray();
  if (!live.length) {
    return 0;
  }
  const chromeTabs = await chrome.tabs.query({ windowId });
  const seen = new Map<number, chrome.tabs.Tab>();
  chromeTabs.forEach((chromeTab) => {
    if (chromeTab.id !== undefined && !isTabSpaceManagerPage(chromeTab)) {
      seen.set(chromeTab.id, chromeTab);
    }
  });

  let next: TabSpace = tabSpace;
  let changed = 0;
  for (const tab of live) {
    const chromeTab = seen.get(tab.chromeTabId);
    if (!chromeTab || chromeTab.splitViewId === undefined) {
      // No answer for this tab. Leaving it alone is the point.
      continue;
    }
    if (chromeTab.splitViewId === tab.splitViewId) {
      continue;
    }
    next = updateTab(
      { tid: tab.id, changes: { splitViewId: chromeTab.splitViewId } },
      next,
    );
    changed += 1;
  }
  if (changed === 0) {
    return 0;
  }
  tabSpaceStoreApi.update(next);
  // The store holds the answer now; the record is what the console draws, so it
  // has to follow. Debounced, like every other save here.
  saveCurrentTabSpace();
  logger.log(
    `split rescan: ${changed} tab(s) read differently from the record`,
  );
  return changed;
}

/**
 * Starts the scan for as long as this page lives. There is nothing to tear
 * down: a module interval dies with its document, which is the tabverse page
 * itself, and the next one starts its own.
 */
export function startSplitViewRescan(): void {
  if (!hasCapability('splitViewRead')) {
    return;
  }
  setInterval(() => {
    void refreshSplitViews().catch((err) =>
      logger.error('the split view rescan failed', err),
    );
  }, SPLIT_RESCAN_INTERVAL_MS);
}
