/**
 * What one tabverse looks like, worked out before anything is drawn.
 *
 * The server hands the console a tabverse as a *bundle*: the tabverse row, its
 * own decoded payload (where the tab groups live), and every record that hangs
 * off it, already sorted by the client's own ordering (`tabIds` for the tabs,
 * the `allnote` / `alltodo` / `allbookmark` aggregates for the rest - the
 * server reads those lists rather than re-deriving them, so the console cannot
 * disagree with the browser about the user's order).
 *
 * The shape a tab list *reads* is a separate question from the order the rows
 * arrive in, and that is what this module answers: a tab group is a block, not a
 * heading above a row, so a group appears where its first member is and takes
 * the rest of its members with it. The tabs of a group that were saved in a
 * different order than the tabverse still belong to it, so membership is by id
 * and not by adjacency.
 *
 * Everything here is pure: it takes a bundle and returns models, which is what
 * makes the drawer's content testable without a DOM.
 */

import type { BundleRow, TabGroupHint, TabspaceBundle } from './types';

export interface TabCardModel {
  id: string;
  title: string;
  url: string;
  favIconUrl: string;
  pinned: boolean;
  suspended: boolean;
  rev: number;
  updatedAt: number;
  position: number;
}

export type TabverseEntry =
  | { kind: 'tab'; tab: TabCardModel }
  | { kind: 'group'; group: TabGroupHint; tabs: TabCardModel[] };

const str = (row: BundleRow, key: string): string => {
  const value = row.data ? row.data[key] : undefined;
  return typeof value === 'string' ? value : '';
};

export function toTabCard(row: BundleRow): TabCardModel {
  return {
    id: row.id,
    title: str(row, 'title'),
    url: str(row, 'url'),
    favIconUrl: str(row, 'favIconUrl'),
    pinned: row.data?.pinned === true,
    suspended: row.data?.suspended === true,
    rev: row.rev,
    updatedAt: row.updated_at,
    position: row.position,
  };
}

/** The tabverse's own groups, in the order its payload lists them. */
export function tabspaceGroups(bundle: TabspaceBundle): TabGroupHint[] {
  const raw = bundle.tabspace_data?.tabGroups;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((g) => g && typeof g === 'object')
    .map((g) => ({
      id: String(g.id ?? ''),
      title: typeof g.title === 'string' ? g.title : '',
      color: typeof g.color === 'string' ? g.color : 'grey',
      tabIds: Array.isArray(g.tabIds) ? g.tabIds.map(String) : [],
    }));
}

function groupOf(groups: TabGroupHint[]): Map<string, TabGroupHint> {
  const byTab = new Map<string, TabGroupHint>();
  for (const group of groups) {
    for (const tabId of group.tabIds) byTab.set(tabId, group);
  }
  return byTab;
}

/**
 * The tabverse's tab list, as the drawer draws it: tabs in stored order, a group
 * as one block at its first member, and a group whose tabs are all gone kept at
 * the end so it is not invisible.
 */
export function tabverseEntries(bundle: TabspaceBundle): TabverseEntry[] {
  const groups = tabspaceGroups(bundle);
  const byTab = groupOf(groups);
  const rows = [...bundle.tabs].sort((a, b) => a.position - b.position);
  const consumed = new Set<string>();
  const entries: TabverseEntry[] = [];

  for (const row of rows) {
    if (consumed.has(row.id)) continue;
    consumed.add(row.id);
    const group = byTab.get(row.id);
    if (!group) {
      entries.push({ kind: 'tab', tab: toTabCard(row) });
      continue;
    }
    const members = rows
      .filter((candidate) => group.tabIds.indexOf(candidate.id) >= 0)
      .map(toTabCard);
    for (const member of members) consumed.add(member.id);
    entries.push({ kind: 'group', group, tabs: members });
  }

  for (const group of groups) {
    if (!group.tabIds.some((tabId) => consumed.has(tabId))) {
      entries.push({ kind: 'group', group, tabs: [] });
    }
  }

  return entries;
}

/** "Working on 7 tabs in 2 groups", the line above the cards. */
export function tabverseSummary(bundle: TabspaceBundle): {
  tabs: number;
  groups: number;
} {
  return { tabs: bundle.tabs.length, groups: tabspaceGroups(bundle).length };
}

/** Everything the tabverse carries that is not a tab, as one count. */
export function storedCount(bundle: TabspaceBundle): number {
  return (
    bundle.notes.length +
    bundle.todos.length +
    bundle.bookmarks.length +
    bundle.closed_tabs.length
  );
}

/**
 * The CSS custom property for one of Chrome's nine group colours. An unknown
 * colour (a record written by a newer client) falls back to grey rather than to
 * no colour at all, which would read as "not in a group".
 */
export function groupColorVar(color: string): string {
  const known = [
    'grey',
    'blue',
    'red',
    'yellow',
    'green',
    'pink',
    'purple',
    'cyan',
    'orange',
  ];
  return `var(--group-${known.indexOf(color) >= 0 ? color : 'grey'})`;
}
