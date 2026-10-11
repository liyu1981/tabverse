import { Button, InputGroup, Spinner, Switch } from '@blueprintjs/core';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useUnit } from 'effector-react';

import {
  openTabspaceById,
  runSearch,
  toggleDataArchived,
} from '../data/actions';
import { $account, $dataArchived } from '../data/stores/accounts';
import { $search, setSearchQuery } from '../data/stores/browse';
import { ago } from '../data/format';
import type { AdminSearchHit } from '../data/types';
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
 * The tabs are a vertical rail on the left; on the right each tabverse shows
 * its name, dates and size, then the matched records with the query terms
 * highlighted.
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
  /** Tabverse metadata, when the server sent it. */
  tabs?: number;
  createdAt?: number;
  updatedAt?: number;
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
    const bucket = tabverse.hitsByKind[hit.entity] ?? [];
    bucket.push(hit);
    tabverse.hitsByKind[hit.entity] = bucket;
    // Prefer the tabverse's own name: a tabspace hit's title, else the
    // tabspace_title the server filled in on any child hit.
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

/** The kinds present in a tabverse, in the canonical kind order. */
export function kindsInTabverse(tabverse: TabverseMatches): string[] {
  const kinds = [...SEARCH_KIND_ORDER];
  for (const present of Object.keys(tabverse.byKind)) {
    if (!kinds.includes(present)) kinds.push(present);
  }
  return kinds.filter((kind) => (tabverse.byKind[kind] || 0) > 0);
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

export interface TextPart {
  text: string;
  match: boolean;
}

/** Splits `text` on the query terms (case-insensitive) for `<mark>`ing. */
export function highlightTerms(text: string, terms: string[]): TextPart[] {
  const wanted = terms
    .map((term) => term.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!text || wanted.length === 0) {
    return [{ text, match: false }];
  }
  const escaped = wanted.map((term) =>
    term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts: TextPart[] = [];
  let last = 0;
  for (
    let found = pattern.exec(text);
    found !== null;
    found = pattern.exec(text)
  ) {
    if (found.index > last) {
      parts.push({ text: text.slice(last, found.index), match: false });
    }
    parts.push({ text: found[0], match: true });
    last = found.index + found[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts;
}

/** The FTS snippet marks matches with `[ ]`; turn those into `<mark>`s. */
export function parseSnippet(snippet: string): TextPart[] {
  const parts: TextPart[] = [];
  const pattern = /\[([^\]]*)\]/g;
  let last = 0;
  for (
    let found = pattern.exec(snippet);
    found !== null;
    found = pattern.exec(snippet)
  ) {
    if (found.index > last) {
      parts.push({ text: snippet.slice(last, found.index), match: false });
    }
    parts.push({ text: found[1], match: true });
    last = found.index + found[0].length;
  }
  if (last < snippet.length) {
    parts.push({ text: snippet.slice(last), match: false });
  }
  return parts;
}

function Highlighted(props: { parts: TextPart[] }) {
  let offset = 0;
  return (
    <>
      {props.parts.map((part) => {
        const key = `${offset}-${part.match ? 'm' : 't'}`;
        offset += part.text.length;
        return part.match ? (
          <mark key={key}>{part.text}</mark>
        ) : (
          <React.Fragment key={key}>{part.text}</React.Fragment>
        );
      })}
    </>
  );
}

/** "12 tabs · created 3d ago · updated 2h ago", only the parts we have. */
export function tabverseMetaLine(tabverse: TabverseMatches): string {
  const bits: string[] = [];
  if (tabverse.tabs) {
    bits.push(`${tabverse.tabs} tab${tabverse.tabs === 1 ? '' : 's'}`);
  }
  if (tabverse.createdAt) bits.push(`created ${ago(tabverse.createdAt)}`);
  if (tabverse.updatedAt) bits.push(`updated ${ago(tabverse.updatedAt)}`);
  return bits.join(' · ');
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

  const q = search.q.trim();
  const terms = useMemo(() => q.split(/\s+/).filter(Boolean), [q]);
  const tabverses = useMemo(() => collectTabverses(search.hits), [search.hits]);
  const tabs = useMemo(() => searchTabs(tabverses), [tabverses]);
  // A new search can drop the tab that was open; fall back to Overview.
  const active = tabs.some((tab) => tab.key === activeKind)
    ? activeKind
    : 'overview';
  const ranked = rankTabverses(tabverses, active);

  if (!account?.user) return null;
  const who = account.user.name || account.user.id;

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
          className={clsx('grow', classes.searchInput)}
          type="search"
          large={true}
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
        <div className={classes.searchLayout}>
          <nav className={classes.kindTabs} aria-label="Search result kinds">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={clsx(
                  classes.kindTab,
                  tab.key === active && classes.kindTabActive,
                )}
                onClick={() => setActiveKind(tab.key)}
              >
                <span>{tab.label}</span>
                <span className={classes.kindTabCount}>{tab.count}</span>
              </button>
            ))}
          </nav>
          <div className={classes.searchResults}>
            {ranked.map((tabverse) => (
              <TabverseCard
                key={`${tabverse.id}/${active}`}
                tabverse={tabverse}
                outerKind={active}
                terms={terms}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * One matched tabverse. Inside an Overview tab the matched records are grouped
 * into their own tabs by kind; in a kind tab there is only one kind, so the
 * inner strip is hidden. The `key` the parent gives it includes the outer kind,
 * so switching the outer tab resets the inner selection.
 */
function TabverseCard(props: {
  tabverse: TabverseMatches;
  outerKind: string;
  terms: string[];
}) {
  const { tabverse, outerKind, terms } = props;
  const subKinds =
    outerKind === 'overview' ? kindsInTabverse(tabverse) : [outerKind];
  const [inner, setInner] = useState(subKinds[0] ?? 'overview');
  const hits =
    outerKind === 'overview'
      ? tabverse.hitsByKind[inner] || []
      : hitsForTabverse(tabverse, outerKind);
  const matches = matchCount(tabverse, outerKind);

  return (
    <section className={classes.searchTabverse}>
      <div className={classes.searchTabverseHead}>
        <div className={classes.searchTabverseTitle}>
          <span className={classes.searchTabverseName}>
            {tabverse.title || '(no tabverse)'}
          </span>
          <span className={classes.searchTabverseMeta}>
            {tabverseMetaLine(tabverse) || tabverse.id}
          </span>
        </div>
        <span className={classes.searchTabverseCount}>
          {matches} match{matches === 1 ? '' : 'es'}
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
      {subKinds.length > 1 ? (
        <div className={classes.itemTabs}>
          {subKinds.map((kind) => (
            <button
              key={kind}
              type="button"
              className={clsx(
                classes.itemTab,
                kind === inner && classes.itemTabActive,
              )}
              onClick={() => setInner(kind)}
            >
              {SEARCH_KIND_LABEL[kind] || kind}
              <span className={classes.itemTabCount}>
                {tabverse.byKind[kind] || 0}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <div className={classes.recordList}>
        {hits.map((hit) => (
          <HitCard key={`${hit.entity}/${hit.id}`} hit={hit} terms={terms} />
        ))}
      </div>
    </section>
  );
}

function HitCard(props: { hit: AdminSearchHit; terms: string[] }) {
  const hit = props.hit;
  const title = hit.title || hit.id;
  return (
    <div className={classes.record}>
      <div className={classes.recordHead}>
        <span className={classes.entity}>{hit.entity}</span>
        <span className="muted small">score {hit.score.toFixed(2)}</span>
      </div>
      <div className={classes.searchHitTitle} title={title}>
        <Highlighted parts={highlightTerms(title, props.terms)} />
      </div>
      {hit.url ? (
        <a
          className={classes.searchHitUrl}
          href={hit.url}
          target="_blank"
          rel="noreferrer noopener"
          title={hit.url}
        >
          <Highlighted parts={highlightTerms(hit.url, props.terms)} />
        </a>
      ) : null}
      {hit.snippet ? (
        <pre className={classes.searchHitSnippet}>
          <Highlighted parts={parseSnippet(hit.snippet)} />
        </pre>
      ) : null}
    </div>
  );
}
