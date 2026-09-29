import { $allBookmark } from '../bookmark/store';
import { $allClosedTab } from '../closedTab/store';
import { $allNote } from '../note/store';
import { $allTodo } from '../todo/store';
import { $tabSpace } from './store';
import { logger } from '../../global';
import { saveAllBookmark } from '../bookmark/util';
import { saveAllClosedTabs } from '../closedTab/util';
import { saveAllNote } from '../note/util';
import { saveAllTodo } from '../todo/util';
import { saveCurrentTabSpaceNow } from './util';

/**
 * "Save and close": save everything this page owns, then close the tabverse
 * tab.
 *
 * The tabverse is saved automatically (on every tab event, and once at
 * bootstrap), so this is not about the tabverse itself - it is about the two
 * things that would otherwise be lost:
 *
 *  - a *pending* save. Every save path is debounced by a second, and this page
 *    is about to be torn down, so a debounce that has not fired yet never
 *    will. Hence `saveCurrentTabSpaceNow` and the immediate savers of the right
 *    side tools.
 *  - the tools whose panels were never opened. Their stores are still empty,
 *    and saving an empty store would write a junk aggregate row keyed to
 *    nothing, so each one is flushed only if it actually belongs to this
 *    tabverse.
 *
 * Closing the tabverse tab does not touch the window's other tabs: they stay
 * open as ordinary Chrome tabs, untracked, and the tabverse itself is already
 * in the saved list (and reachable from the toolbar popup).
 *
 * This lives in its own module on purpose: it is the only place that knows
 * about the right side tools, so nothing else - the search module, the popup -
 * drags them into its dependency graph.
 */

/** The right side tools, in the order they appear in the panel. */
const rightSideToolSavers = [
  {
    name: 'todo',
    tabSpaceIdOf: () => $allTodo.getState().tabSpaceId,
    save: saveAllTodo,
  },
  {
    name: 'note',
    tabSpaceIdOf: () => $allNote.getState().tabSpaceId,
    save: saveAllNote,
  },
  {
    name: 'bookmark',
    tabSpaceIdOf: () => $allBookmark.getState().tabSpaceId,
    save: saveAllBookmark,
  },
  {
    name: 'closed tab',
    tabSpaceIdOf: () => $allClosedTab.getState().tabSpaceId,
    save: saveAllClosedTabs,
  },
];

export async function saveAndFlushRightSideTools(): Promise<void> {
  const tabSpaceId = $tabSpace.getState().id;
  const results = await Promise.allSettled(
    rightSideToolSavers
      .filter((tool) => tool.tabSpaceIdOf() === tabSpaceId)
      .map(async (tool) => {
        logger.log('save and close: flushing', tool.name);
        await tool.save();
      }),
  );
  const failed = results.filter((result) => result.status === 'rejected');
  if (failed.length > 0) {
    // closing the tab anyway is right - the tabverse itself is saved - but the
    // user should not lose a note to a silent failure
    logger.error(
      'save and close: some right side data did not save',
      failed.map((result) => (result as PromiseRejectedResult).reason),
    );
  }
}

export async function saveAndCloseTabSpace(): Promise<void> {
  const chromeTabId = $tabSpace.getState().chromeTabId;
  await saveCurrentTabSpaceNow();
  await saveAndFlushRightSideTools();
  if (chromeTabId < 0) {
    logger.log('save and close: no tabverse tab to close');
    return;
  }
  await chrome.tabs.remove(chromeTabId);
}
