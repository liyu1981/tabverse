import { Tab, findSplitPartner } from './Tab';
import { TabGroupHint, TabSpace, findTabById, getTabIds } from './TabSpace';
import { groupOfTab } from './tabGroup';

/**
 * One row of a tabverse's tab list.
 *
 * Two of the three kinds are composites: a tab group (a header plus its tabs,
 * behind a coloured rule) and a split view (the two tabs Chrome shows side by
 * side, drawn as one block). A composite appears where its first tab is, so
 * the list reads in tab order; a group whose tabs are all gone is appended at
 * the end rather than dropped.
 *
 * This is the single description of "how does a tabverse's tab list read",
 * shared by the live list and the saved one - they used to disagree, and the
 * saved list is where a user goes to check what a tabverse actually holds.
 */
export type TabverseEntry =
  | { kind: 'tab'; tab: Tab }
  | { kind: 'split'; tabs: [Tab, Tab] }
  | { kind: 'group'; group: TabGroupHint; tabs: Tab[] };

export function tabverseEntries(targetTabSpace: TabSpace): TabverseEntry[] {
  const tabIdOrder = getTabIds(targetTabSpace);
  const consumedTabIds = new Set<string>();
  const entries: TabverseEntry[] = [];

  const tabsOfGroup = (group: TabGroupHint): Tab[] =>
    group.tabIds
      .filter((tabId) => tabIdOrder.indexOf(tabId) >= 0)
      .map((tabId) => findTabById(tabId, targetTabSpace))
      .filter((tab): tab is Tab => !!tab);

  for (const tabId of tabIdOrder) {
    if (consumedTabIds.has(tabId)) {
      continue;
    }
    const tab = findTabById(tabId, targetTabSpace);
    if (!tab) {
      continue;
    }
    consumedTabIds.add(tabId);

    // a group is emitted where its first tab is, and takes the rest of its tabs
    // with it - Chrome's tab strip interleaves groups with ungrouped tabs, and a
    // saved tabverse has to read the way the window looked
    const group = groupOfTab(targetTabSpace.tabGroups, tabId);
    if (group) {
      const tabs = tabsOfGroup(group);
      for (const grouped of tabs) {
        consumedTabIds.add(grouped.id);
      }
      if (tabs.length > 0) {
        entries.push({ kind: 'group', group, tabs });
      }
      continue;
    }

    const partner = findSplitPartner(tab, targetTabSpace.tabs);
    if (partner && tabIdOrder.indexOf(partner.id) >= 0) {
      consumedTabIds.add(partner.id);
      entries.push({ kind: 'split', tabs: [tab, partner] });
    } else {
      entries.push({ kind: 'tab', tab });
    }
  }

  // a group whose tabs are all gone (a filtered list, or tabs that were closed
  // but never reaped) still gets a header, so the group is not invisible
  for (const group of targetTabSpace.tabGroups ?? []) {
    if (!group.tabIds.some((tabId) => consumedTabIds.has(tabId))) {
      entries.push({ kind: 'group', group, tabs: [] });
    }
  }

  return entries;
}
