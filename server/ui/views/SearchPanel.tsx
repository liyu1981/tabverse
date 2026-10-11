import { Button, InputGroup, Spinner, Switch } from '@blueprintjs/core';
import React, { useEffect, useRef, useState } from 'react';
import { useUnit } from 'effector-react';

import {
  openTabspaceById,
  runSearch,
  toggleDataArchived,
} from '../data/actions';
import { $account, $dataArchived } from '../data/stores/accounts';
import { $search, setSearchQuery } from '../data/stores/browse';
import type { AdminSearchHit } from '../data/types';
import { Segmented } from '../components/Pager';
import { useDebounced } from '../components/useDebounced';
import layout from '../layout.module.scss';
import classes from '../data.module.scss';

/**
 * Unified full text search over one account: the same FTS5 index the extension
 * queries (adr/0008), every whitespace-separated term must match and the last
 * one is a prefix, so results narrow as the operator types.
 *
 * The results are **tabverse centric**. Every hit belongs to a tabverse, and
 * each tab is a ranking of tabverses rather than a flat list of records:
 *
 *   - **Overview** ranks by how many records of any kind matched in the tabverse;
 *   - **Tabs**, **History**, **Notes**, ... rank by how many of *that* kind
 *     matched.
 *
 * Inside a tabverse the matched records themselves are listed, so a search
 * answers both "which tabverse" and "what in it".
 */
export const SEARCH_KIND_ORDER = [
  'tabspace',
  'tab',
  'closedtab',
  'note',
  'todo',
  'bookmark',
  'session',
];

export const SEARCH_KIND_LABEL: Record<string, string> = {
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
  hitsByKind: Record<string, AdminSearchHit[]>;
}

export interface SearchTab {
  key: string;
  label: string;
  count: number;
}

function tabverseIdOf(hit: AdminSearchHit): string {
  return hit.entity === 'tabspace' ? hit.id : hit.tabspace_id || '';
}

/**
 * Folds a flat hit list into one bucket per tabverse, counting and keeping the
 * hits per kind. Pure and exported so the ranking can be tested without a
 * browser.
 */
export function collectTabverses(hits: AdminSearchHit[]): TabverseMatches[] {
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
    (tabverse.hitsByKind[hit.entity] ||= []).push(hit);
    // Prefer the tabverse's own name: a tabspace hit's title, else the
    // tabspace_title the server filled in on any child hit.
    if (!tabverse.title) {
      if (hit.entity === 'tabspace' && hit.title) tabverse.title = hit.title;
      else if (hit.tabspace_title) tabverse.title = hit.tabspace_title;
    }
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
export function searchTabs(tabverses: TabverseMatches[]): SearchTab[] {
  const sum = (kind: string) =>
    tabverses.reduce((n, tabverse) => n + (tabverse.byKind[kind] || 0), 0);
  const total = tabverses.reduce((n, tabverse) => n + tabverse.total, 0);
  const tabs: SearchTab[] = [
    { key: 'overview', label: 'Overview', count: total },
  ];
  const kinds = [...SEARCH_KIND_ORDER];
  for (const tabverse of tabverses) {
    for (const kind of Object.keys(tabverse.byKind)) {
      if (!kinds.includes(kind)) kinds.push(kind);
    }
  }
  for (const kind of kinds) {
    const count = sum(kind);
    if (count > 0) {
      tabs.push({ key: kind, label: SEARCH_KIND_LABEL[kind] || kind, count });
    }
  }
  return tabs;
}

/** How many records this tabverse matched for a tab (`overview` = all). */
export function matchCount(tabverse: TabverseMatches, kind: string): number {
  return kind === 'overview' ? tabverse.total : tabverse.byKind[kind] || 0;
}

/**
 * The tabverses a tab shows, best match first: by the kind's match count, then
 * by total matches, then by name so the order is stable.
 */
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

/** The records a tab shows inside one tabverse. */
export function hitsForTabverse(
  tabverse: TabverseMatches,
  kind: string,
): AdminSearchHit[] {
  if (kind !== 'overview') {
    return tabverse.hitsByKind[kind] || [];
  }
  const out: AdminSearchHit[] = [];
  const kinds = [...SEARCH_KIND_ORDER];
  for (const present of Object.keys(tabverse.hitsByKind)) {
    if (!kinds.includes(present)) kinds.push(present);
  }
  for (const present of kinds) {
    out.push(...(tabverse.hitsByKind[present] || []));
  }
  return out;
}

export function SearchPanel() {
  const { account, search, archived } = useUnit({
    account: $account,
    search: $search,
    archived: $dataArchived,
  });
  const settled = useDebounced(search.q, 250);
  const firstSettle = useRef(true);
  const [activeKind, setActiveKind] = useState('overview');

  useEffect(() => {
    if (firstSettle.current) {
      firstSettle.current = false;
      return;
    }
    void runSearch();
  }, [settled]);

  if (!account?.user) return null;
  const who = account.user.name || account.user.id;
  const q = search.q.trim();
  const tabverses = collectTabverses(search.hits);
  const tabs = searchTabs(tabverses);
  // A new search can drop the tab that was open; fall back to Overview.
  const active = tabs.some((tab) => tab.key === activeKind)
    ? activeKind
    : 'overview';
  const ranked = rankTabverses(tabverses, active);

  return (
    <section>
      <div className={layout.panelHead}>
        <div>
          <h2>Search</h2>
          <p className="muted small">
            Full text over this account's tabs, history, notes, todos and
            bookmarks. Results are catalogued by tabverse, ranked by how much of
            each kind matched.
          </p>
        </div>
        <div className={layout.panelHeadActions}>
          <Switch
            checked={archived}
            label="show archived"
            onChange={(event) =>
              void toggleDataArchived(event.currentTarget.checked)
            }
          />
        </div>
      </div>

      <div className="toolbar">
        <InputGroup
          className="grow"
          type="search"
          placeholder="search this account (every term must match, the last one is a prefix)"
          value={search.q}
          onChange={(event) => setSearchQuery(event.currentTarget.value)}
        />
        {search.loading ? <Spinner size={16} /> : null}
      </div>

      <p className="muted small">
        {q
          ? search.searched
            ? `${who} · ${search.hits.length} hit${
                search.hits.length === 1 ? '' : 's'
              } in ${tabverses.length} tabverse${
                tabverses.length === 1 ? '' : 's'
              } for "${q}"`
            : `${who} · searching for "${q}"`
          : `${who} · type to search`}
      </p>

      {!q ? (
        <p className="empty-inline">
          search across tabs, history, notes, todos and bookmarks
        </p>
      ) : search.problem ? (
        <p className="empty-inline">{search.problem}</p>
      ) : !search.hits.length ? (
        <p className="empty-inline">nothing matched</p>
      ) : (
        <div>
          <div className="toolbar">
            <Segmented
              ariaLabel="Search result kinds"
              value={active}
              options={tabs.map((tab) => ({
                value: tab.key,
                label: `${tab.label} (${tab.count})`,
              }))}
              onChange={setActiveKind}
            />
          </div>
          {ranked.map((tabverse) => (
            <section key={tabverse.id} className={classes.searchTabverse}>
              <div className={classes.searchTabverseHead}>
                <span className={classes.searchTabverseName}>
                  {tabverse.title || '(no tabverse)'}
                </span>
                <span className={classes.searchTabverseCount}>
                  {matchCount(tabverse, active)} match
                  {matchCount(tabverse, active) === 1 ? '' : 'es'}
                </span>
                {tabverse.id ? (
                  <Button
                    small={true}
                    minimal={true}
                    icon="arrow-right"
                    onClick={() => void openTabspaceById(tabverse.id)}
                  >
                    open tabverse
                  </Button>
                ) : null}
              </div>
              <div className={classes.recordList}>
                {hitsForTabverse(tabverse, active).map((hit) => (
                  <HitCard key={`${hit.entity}/${hit.id}`} hit={hit} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function HitCard(props: { hit: AdminSearchHit }) {
  const hit = props.hit;
  return (
    <div className={classes.record}>
      <div className={classes.recordHead}>
        <span className={classes.entity}>{hit.entity}</span>
        <span className="muted small">score {hit.score.toFixed(2)}</span>
      </div>
      <div className={hit.url ? classes.rowText : undefined}>
        <div className={classes.rowText}>{hit.title || hit.id}</div>
        {hit.url ? (
          <a
            className={classes.payload}
            href={hit.url}
            target="_blank"
            rel="noreferrer noopener"
          >
            {hit.url}
          </a>
        ) : null}
      </div>
      {hit.snippet ? (
        <pre className={classes.payload}>{hit.snippet}</pre>
      ) : null}
    </div>
  );
}
