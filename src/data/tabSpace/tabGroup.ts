/**
 * Tab groups: capture, live tracking and restore.
 *
 * The whole feature is an *enrichment* (see src/capabilities.ts): the baseline
 * tab capture never reads a group field, and every function here fails soft so
 * that a browser without chrome.tabGroups behaves exactly like one without tab
 * groups at all.
 *
 * The identity problem: `chrome.tabGroups` group ids are "unique within a
 * browser session", so they cannot be stored. What we persist is a hint per
 * group - our own id, its title and colour, and the ids of the tabverse's tabs
 * in it - carried inside the tabverse record. The live ourId -> chromeId map is
 * kept in this module's memory and rebuilt on every scan, exactly like the
 * chromeTabId live fields on a tab.
 */

import { TabGroupColor, TabGroupHint, TAB_GROUP_COLORS } from './TabSpace';

import { hasCapability } from '../../capabilities';
import { getNewId } from '../common';
import { logger } from '../../global';

/**
 * Swatches for the nine group colours, for the sidebar/list UI. Chrome's own
 * palette is tuned for its tab strip; these are the same hues, darkened a
 * little so they hold up on a white card.
 */
export const TAB_GROUP_COLORS_JS: { [c in TabGroupColor]: string } = {
  grey: '#8c8c8c',
  blue: '#3b6fd4',
  red: '#d1453b',
  yellow: '#c79100',
  green: '#2f8a4c',
  pink: '#c74392',
  purple: '#8250df',
  cyan: '#0f8ba8',
  orange: '#cc6a2b',
};

/** The group a tab belongs to, or undefined. */
export function groupOfTab(
  groups: TabGroupHint[] | undefined,
  tabId: string,
): TabGroupHint | undefined {
  if (!groups) {
    return undefined;
  }
  return groups.find((group) => group.tabIds.indexOf(tabId) >= 0);
}

/** chrome group id (session scoped) -> our stable group id. */
const chromeGroupToOurId = new Map<number, string>();

export function isTabGroupColor(value: any): value is TabGroupColor {
  return TAB_GROUP_COLORS.indexOf(value) >= 0;
}

function toTabGroupColor(value: any): TabGroupColor {
  return isTabGroupColor(value) ? value : 'grey';
}

function clearGroupIdMapping() {
  chromeGroupToOurId.clear();
}

/** our stable id for a chrome group id, minting one the first time we see it */
function ourIdForChromeGroup(chromeGroupId: number): string {
  const existing = chromeGroupToOurId.get(chromeGroupId);
  if (existing) {
    return existing;
  }
  const ourId = getNewId();
  chromeGroupToOurId.set(chromeGroupId, ourId);
  return ourId;
}

/**
 * Reads the groups of the window we manage and rebuilds the hints.
 *
 * `tabs` is the baseline scan's view of the window (chrome tabs paired with
 * Tabverse tab ids), so this never has to re-query the tab list.
 */
export async function captureTabGroups(
  windowId: number,
  tabIdByChromeTabId: Map<number, string>,
): Promise<TabGroupHint[] | null> {
  if (!hasCapability('tabGroups')) {
    return null;
  }
  try {
    const groups = await chrome.tabGroups.query({ windowId });
    if (!groups || groups.length === 0) {
      clearGroupIdMapping();
      return [];
    }

    const hints: TabGroupHint[] = [];
    for (const group of groups) {
      const tabIds: string[] = [];
      for (const [chromeTabId, ourTabId] of tabIdByChromeTabId.entries()) {
        const chromeTab = await safeGetTab(chromeTabId);
        if (chromeTab && chromeTab.groupId === group.id) {
          tabIds.push(ourTabId);
        }
      }
      if (tabIds.length === 0) {
        // a group of tabs that are not ours (e.g. only the manager tab)
        continue;
      }
      hints.push({
        id: ourIdForChromeGroup(group.id),
        title: group.title ?? '',
        color: toTabGroupColor(group.color),
        tabIds,
      });
    }
    return hints;
  } catch (err) {
    // soft failure: no groups this time, capture continues without them
    logger.log('tabverse: could not read tab groups:', err);
    return null;
  }
}

async function safeGetTab(tabId: number): Promise<chrome.tabs.Tab | undefined> {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return undefined;
  }
}

/**
 * Watches group title/colour/collapse changes. The membership of a single tab
 * arrives through tabs.onUpdated's changeInfo.groupId, which the normal tab
 * update path already sees.
 */
export function startMonitorTabGroups(onChanged: () => void): void {
  if (!hasCapability('tabGroups')) {
    return;
  }
  const changed = () => {
    if (onChanged) {
      onChanged();
    }
  };
  try {
    chrome.tabGroups.onUpdated.addListener(changed);
    chrome.tabGroups.onCreated.addListener(changed);
    chrome.tabGroups.onRemoved.addListener(changed);
    chrome.tabGroups.onMoved.addListener(changed);
  } catch (err) {
    logger.log('tabverse: could not watch tab groups:', err);
  }
}

/**
 * Recreates the tabverse's groups in a freshly restored window.
 *
 * Runs after every tab exists: chrome.tabs.group() needs the tab ids to be
 * there, and a split view (which requires matching group state) is created
 * afterwards. A group whose tabs did not survive is skipped rather than
 * reported - restore is best effort by design.
 */
export async function restoreTabGroups(
  tabSpaceGroups: TabGroupHint[],
  tabIdByOurTabId: Map<string, number>,
  pinned: (tabId: number) => boolean,
): Promise<number> {
  if (!hasCapability('tabGroups')) {
    return 0;
  }
  let restored = 0;
  for (const hint of tabSpaceGroups ?? []) {
    // skip malformed hints (and anything that predates the group feature)
    if (!hint || !hint.id || !Array.isArray(hint.tabIds)) {
      continue;
    }
    const tabIds = hint.tabIds
      .map((ourTabId) => tabIdByOurTabId.get(ourTabId))
      .filter((id): id is number => id !== undefined);
    // a group of one is not a group, and Chrome deletes empty ones anyway
    if (tabIds.length < 2) {
      continue;
    }
    // chrome refuses to mix pinned and unpinned tabs in one group
    const allPinned = tabIds.every((id) => pinned(id));
    const anyPinned = tabIds.some((id) => pinned(id));
    if (allPinned !== anyPinned) {
      logger.log('tabverse: skipping mixed pinned group', hint.id);
      continue;
    }
    try {
      const chromeGroupId = await chrome.tabs.group({
        tabIds: tabIds as [number, ...number[]],
      });
      await chrome.tabGroups.update(chromeGroupId, {
        title: hint.title ?? '',
        color: toTabGroupColor(hint.color),
      });
      chromeGroupToOurId.set(chromeGroupId, hint.id);
      restored += 1;
    } catch (err) {
      logger.log('tabverse: could not restore tab group', hint.id, err);
    }
  }
  return restored;
}

/** Test hook: the chrome-group mapping is module state. */
export function resetTabGroupMappingForTest(): void {
  clearGroupIdMapping();
}
