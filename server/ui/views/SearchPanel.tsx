import { Button, InputGroup, Spinner } from '@blueprintjs/core';
import React, { useEffect, useRef } from 'react';
import { useUnit } from 'effector-react';

import { openTabspaceById, runSearch } from '../data/actions';
import { $account } from '../data/stores/accounts';
import {
  $search,
  setSearchEntity,
  setSearchQuery,
} from '../data/stores/browse';
import type { AdminSearchHit } from '../data/types';
import { EntitySelect } from '../components/EntitySelect';
import { useDebounced } from '../components/useDebounced';
import classes from '../data.module.scss';

/**
 * Full text search over one account: the same FTS5 index the extension queries
 * (adr/0008), every whitespace-separated term must match and the last one is a
 * prefix, so results narrow as the operator types.
 *
 * A hit names the tabverse it belongs to, exactly like the extension's search
 * does, so one click opens the tabverse it came from.
 */
export function SearchPanel() {
  const { account, search } = useUnit({ account: $account, search: $search });
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

  return (
    <div>
      <p className="muted small">
        {q
          ? search.searched
            ? `${who} · ${search.hits.length} hit${
                search.hits.length === 1 ? '' : 's'
              } for "${q}"`
            : `${who} · searching for "${q}"`
          : who}
      </p>

      <div className="toolbar">
        <InputGroup
          className="grow"
          type="search"
          placeholder="full text search (every term must match, the last one is a prefix)"
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

      {!q ? (
        <p className="empty-inline">type to search this account</p>
      ) : search.problem ? (
        <p className="empty-inline">{search.problem}</p>
      ) : !search.hits.length ? (
        <p className="empty-inline">nothing matched</p>
      ) : (
        <div className={classes.recordList}>
          {search.hits.map((hit) => (
            <HitCard
              key={`${hit.entity}/${hit.id}`}
              hit={hit}
              onOpen={() => void openTabspaceById(hit.tabspace_id as string)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HitCard(props: { hit: AdminSearchHit; onOpen: () => void }) {
  const hit = props.hit;
  return (
    <div className={classes.record}>
      <div className={classes.recordHead}>
        <span className={classes.entity}>{hit.entity}</span>
        <span className="muted small">score {hit.score.toFixed(2)}</span>
        {hit.tabspace_id ? (
          <Button
            small={true}
            minimal={true}
            icon="arrow-right"
            onClick={props.onOpen}
          >
            open tabverse
          </Button>
        ) : null}
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
