import { Tab, findSplitPartner } from './Tab';
import { List } from 'immutable';
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
    // a partner already consumed is one this list has already drawn - inside
    // a group above, or as the other half of a split. Drawing it again would
    // show the same tab twice, so this one stands on its own instead.
    if (
      partner &&
      !consumedTabIds.has(partner.id) &&
      tabIdOrder.indexOf(partner.id) >= 0
    ) {
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

/** The tabs of one entry, whether it is a plain tab or a composite. */
export function entryTabs(entry: TabverseEntry): Tab[] {
  return entry.kind === 'tab' ? [entry.tab] : entry.tabs;
}

/** One entry *inside* a group: a plain tab, or the pair of a split view. */
export type TabSubEntry =
  | { kind: 'tab'; tab: Tab }
  | { kind: 'split'; tabs: [Tab, Tab] };

/**
 * The entries inside a group: plain tabs, with a split pair drawn as one block.
 *
 * The top-level builder cannot do this: a group takes its tabs and stops
 * (`continue`), which is why a split view opened *inside* a group used to render
 * as three ordinary cards - no block, and the pairing lost. The group's block is
 * drawn by its host (the live list, the saved view, the console's drawer), and
 * they are three of them, so this is the shared half: what the list of a
 * group's tabs reads as.
 *
 * Pairs are found within the given tabs only, so a split whose partner sits
 * outside the group is drawn as what it is from in here: an ordinary tab.
 */
export function subEntriesOfTabs(tabs: Tab[]): TabSubEntry[] {
  const asList = List(tabs);
  const consumed = new Set<string>();
  const entries: TabSubEntry[] = [];
  for (const tab of tabs) {
    if (consumed.has(tab.id)) {
      continue;
    }
    const partner = findSplitPartner(tab, asList);
    if (partner && partner.id !== tab.id && !consumed.has(partner.id)) {
      consumed.add(tab.id);
      consumed.add(partner.id);
      entries.push({ kind: 'split', tabs: [tab, partner] });
      continue;
    }
    consumed.add(tab.id);
    entries.push({ kind: 'tab', tab });
  }
  return entries;
}

/**
 * Every tab of a tabverse in the order the list above shows them.
 *
 * The composite entries are flattened (both halves of a split view, a group's
 * tabs under their header), so a caller that wants a plain list of tabs - the
 * filter box, which ranks matches and therefore cannot nest them back into the
 * blocks they came from - reads the list in the order the user sees.
 */
export function tabverseTabs(targetTabSpace: TabSpace): Tab[] {
  return tabverseEntries(targetTabSpace).flatMap(entryTabs);
}
