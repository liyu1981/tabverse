import { SearchHit } from '../../../data/repo/types';

/**
 * The omni search groups its hits the same way the server console does.
 *
 * Every hit belongs to a tabverse, and each tab is a **ranking of tabverses**
 * rather than a flat list of records: Overview ranks by how many records of any
 * kind matched, and each kind tab (Tabs, History, Notes, ...) by how many of
 * that kind matched. Inside a tabverse the matched records themselves are
 * listed. Kept pure and separate from the view so it can be tested without a
 * browser.
 */
const OMNI_ENTITY_ORDER = [
  'tabspace',
  'tab',
  'closedtab',
  'note',
  'todo',
  'bookmark',
  'session',
];

const OMNI_ENTITY_LABEL: Record<string, string> = {
  tabspace: 'Tabverses',
  tab: 'Tabs',
  closedtab: 'History',
  note: 'Notes',
  todo: 'Todos',
  bookmark: 'Bookmarks',
  session: 'Sessions',
};

export interface TabverseMatches {
  id: string;
  title: string;
  /** Every hit in this tabverse, across kinds. */
  total: number;
  byKind: Record<string, number>;
  hitsByKind: Record<string, SearchHit[]>;
  /** Tabverse metadata, when the server sent it. */
  tabs?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface OmniTab {
  key: string;
  label: string;
  count: number;
}

function tabverseIdOf(hit: SearchHit): string {
  return hit.entity === 'tabspace' ? hit.id : hit.tabspace_id || '';
}

export function collectTabverses(hits: SearchHit[]): TabverseMatches[] {
  const byTabverse = new Map<string, TabverseMatches>();
  for (const hit of hits) {
    const id = tabverseIdOf(hit);
    let tabverse = byTabverse.get(id);
    if (!tabverse) {
      tabverse = { id, title: '', total: 0, byKind: {}, hitsByKind: {} };
      byTabverse.set(id, tabverse);
    }
    tabverse.total += 1;
    tabverse.byKind[hit.entity] = (tabverse.byKind[hit.entity] || 0) + 1;
    const bucket = tabverse.hitsByKind[hit.entity] ?? [];
    bucket.push(hit);
    tabverse.hitsByKind[hit.entity] = bucket;
    if (!tabverse.title) {
      if (hit.entity === 'tabspace' && hit.title) tabverse.title = hit.title;
      else if (hit.tabspace_title) tabverse.title = hit.tabspace_title;
    }
    tabverse.tabs ||= hit.tabspace_tabs;
    tabverse.createdAt ||= hit.tabspace_created_at;
    tabverse.updatedAt ||= hit.tabspace_updated_at;
  }
  for (const tabverse of byTabverse.values()) {
    for (const kind of Object.keys(tabverse.hitsByKind)) {
      tabverse.hitsByKind[kind].sort((a, b) => b.score - a.score);
    }
    if (!tabverse.title) tabverse.title = tabverse.id;
  }
  return [...byTabverse.values()];
}

/** The tab strip: Overview first, then one tab per kind that matched. */
export function omniTabs(tabverses: TabverseMatches[]): OmniTab[] {
  const sum = (kind: string) =>
    tabverses.reduce((n, tabverse) => n + (tabverse.byKind[kind] || 0), 0);
  const total = tabverses.reduce((n, tabverse) => n + tabverse.total, 0);
  const tabs: OmniTab[] = [
    { key: 'overview', label: 'Overview', count: total },
  ];
  const kinds = [...OMNI_ENTITY_ORDER];
  for (const tabverse of tabverses) {
    for (const kind of Object.keys(tabverse.byKind)) {
      if (!kinds.includes(kind)) kinds.push(kind);
    }
  }
  for (const kind of kinds) {
    const count = sum(kind);
    if (count > 0) {
      tabs.push({ key: kind, label: OMNI_ENTITY_LABEL[kind] || kind, count });
    }
  }
  return tabs;
}

/** How many records this tabverse matched for a tab (`overview` = all). */
export function matchCount(tabverse: TabverseMatches, kind: string): number {
  return kind === 'overview' ? tabverse.total : tabverse.byKind[kind] || 0;
}

/** The kinds present in a tabverse, in the canonical kind order. */
export function kindsInTabverse(tabverse: TabverseMatches): string[] {
  const kinds = [...OMNI_ENTITY_ORDER];
  for (const present of Object.keys(tabverse.byKind)) {
    if (!kinds.includes(present)) kinds.push(present);
  }
  return kinds.filter((kind) => (tabverse.byKind[kind] || 0) > 0);
}

export function rankTabverses(
  tabverses: TabverseMatches[],
  kind: string,
): TabverseMatches[] {
  return tabverses
    .filter((tabverse) => matchCount(tabverse, kind) > 0)
    .sort((a, b) => {
      const byKind = matchCount(b, kind) - matchCount(a, kind);
      if (byKind !== 0) return byKind;
      if (b.total !== a.total) return b.total - a.total;
      return a.title.localeCompare(b.title);
    });
}

export function hitsForTabverse(
  tabverse: TabverseMatches,
  kind: string,
): SearchHit[] {
  if (kind !== 'overview') {
    return tabverse.hitsByKind[kind] || [];
  }
  const out: SearchHit[] = [];
  const kinds = [...OMNI_ENTITY_ORDER];
  for (const present of Object.keys(tabverse.hitsByKind)) {
    if (!kinds.includes(present)) kinds.push(present);
  }
  for (const present of kinds) {
    out.push(...(tabverse.hitsByKind[present] || []));
  }
  return out;
}
