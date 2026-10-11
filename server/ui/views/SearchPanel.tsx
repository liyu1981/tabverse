import { Button, InputGroup, Spinner, Switch } from '@blueprintjs/core';
import React, { useEffect, useRef } from 'react';
import { useUnit } from 'effector-react';

import {
  openTabspaceById,
  runSearch,
  toggleDataArchived,
} from '../data/actions';
import { $account, $dataArchived } from '../data/stores/accounts';
import {
  $search,
  setSearchEntity,
  setSearchQuery,
} from '../data/stores/browse';
import type { AdminSearchHit } from '../data/types';
import { EntitySelect } from '../components/EntitySelect';
import { useDebounced } from '../components/useDebounced';
import layout from '../layout.module.scss';
import classes from '../data.module.scss';

/**
 * Unified full text search over one account: the same FTS5 index the extension
 * queries (adr/0008), every whitespace-separated term must match and the last
 * one is a prefix, so results narrow as the operator types.
 *
 * Results are grouped by entity - Tabverses, Tabs, History, Notes, Todos,
 * Bookmarks - and, within each, by the tabverse they belong to, so a search
 * shows where in the account a word lives instead of one flat list. Every hit
 * names its tabverse, exactly like the extension's search does, so one click
 * opens it.
 */
const ENTITY_ORDER = [
  'tabspace',
  'tab',
  'closedtab',
  'note',
  'todo',
  'bookmark',
  'session',
];

const ENTITY_LABEL: Record<string, string> = {
  tabspace: 'Tabverses',
  tab: 'Tabs',
  closedtab: 'History',
  note: 'Notes',
  todo: 'Todos',
  bookmark: 'Bookmarks',
  session: 'Sessions',
};

interface TabverseHits {
  id: string;
  title: string;
  hits: AdminSearchHit[];
}

interface EntityHits {
  entity: string;
  label: string;
  count: number;
  tabverses: TabverseHits[];
}

/**
 * Buckets hits by entity, then by tabverse. Kept pure and exported so the
 * grouping can be tested without a browser.
 */
export function groupHits(hits: AdminSearchHit[]): EntityHits[] {
  const byEntity = new Map<string, AdminSearchHit[]>();
  for (const hit of hits) {
    const list = byEntity.get(hit.entity);
    if (list) list.push(hit);
    else byEntity.set(hit.entity, [hit]);
  }
  const known = ENTITY_ORDER.filter((entity) => byEntity.has(entity));
  const unknown = [...byEntity.keys()].filter(
    (entity) => !ENTITY_ORDER.includes(entity),
  );
  const groups: EntityHits[] = [];
  for (const entity of [...known, ...unknown]) {
    const list = byEntity.get(entity) ?? [];
    const byTabverse = new Map<string, AdminSearchHit[]>();
    for (const hit of list) {
      // A tabverse hit is its own group; everything else groups under the
      // tabverse it belongs to (or under "" when the payload carried none).
      const key = entity === 'tabspace' ? hit.id : hit.tabspace_id || '';
      const bucket = byTabverse.get(key);
      if (bucket) bucket.push(hit);
      else byTabverse.set(key, [hit]);
    }
    groups.push({
      entity,
      label: ENTITY_LABEL[entity] || entity,
      count: list.length,
      tabverses: [...byTabverse.entries()].map(([id, grouped]) => ({
        id,
        title:
          grouped[0].tabspace_title ||
          (entity === 'tabspace' ? grouped[0].title : '') ||
          id,
        hits: grouped,
      })),
    });
  }
  return groups;
}

export function SearchPanel() {
  const { account, search, archived } = useUnit({
    account: $account,
    search: $search,
    archived: $dataArchived,
  });
  const settled = useDebounced(search.q, 250);
  const firstSettle = useRef(true);

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
  const groups = groupHits(search.hits);

  return (
    <section>
      <div className={layout.panelHead}>
        <div>
          <h2>Search</h2>
          <p className="muted small">
            Full text over this account's tabs, history, notes, todos and
            bookmarks. Results are grouped by kind, then by tabverse.
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
        <EntitySelect
          omitAggregates={true}
          value={search.entity}
          onChange={(entity) => {
            setSearchEntity(entity);
            void runSearch();
          }}
        />
        {search.loading ? <Spinner size={16} /> : null}
      </div>

      <p className="muted small">
        {q
          ? search.searched
            ? `${who} · ${search.hits.length} hit${
                search.hits.length === 1 ? '' : 's'
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
          {groups.map((group) => (
            <section key={group.entity} className={classes.searchGroup}>
              <h3 className={classes.searchGroupHead}>
                {group.label}
                <span className="muted small">{group.count}</span>
              </h3>
              {group.tabverses.map((tabverse) => (
                <div
                  key={`${group.entity}/${tabverse.id}`}
                  className={classes.searchTabverse}
                >
                  <div className={classes.searchTabverseHead}>
                    <span className={classes.rowName}>
                      {tabverse.title || '(no tabverse)'}
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
                    {tabverse.hits.map((hit) => (
                      <HitCard key={`${hit.entity}/${hit.id}`} hit={hit} />
                    ))}
                  </div>
                </div>
              ))}
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
