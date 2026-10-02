import { InputGroup, Spinner } from '@blueprintjs/core';
import React, { useEffect, useRef } from 'react';
import { useUnit } from 'effector-react';

import { loadTabspaces, openTabspaceById } from '../data/actions';
import { ago, plural } from '../data/format';
import { $account } from '../data/stores/accounts';
import {
  $tabspaces,
  pageTabspaces,
  setTabspaceQuery,
} from '../data/stores/browse';
import type { TabspaceSummary } from '../data/types';
import { Pager } from '../components/Pager';
import { useDebounced } from '../components/useDebounced';
import classes from '../data.module.scss';

/**
 * The tabverse list: one row per saved tabverse with its counts, newest first.
 *
 * A row, not a card: the extension's saved-tabverse list is a list of rows (a
 * name over the numbers), and an operator is comparing twenty of them against
 * each other, which is what rows are for.
 */
export function TabverseList() {
  const { account, list } = useUnit({ account: $account, list: $tabspaces });
  const settled = useDebounced(list.q, 250);
  const firstSettle = useRef(true);

  useEffect(() => {
    if (firstSettle.current) {
      firstSettle.current = false;
      return;
    }
    void loadTabspaces();
  }, [settled]);

  if (!account?.user) return null;
  const who = account.user.name || account.user.id;

  return (
    <div>
      <p className="muted small">
        {who} · {list.total} {plural(list.total, 'tabverse')} stored
        {list.q ? ` matching "${list.q}"` : ''}
      </p>

      <div className="toolbar">
        <InputGroup
          className="grow"
          type="search"
          placeholder="filter tabverses"
          value={list.q}
          onChange={(event) => setTabspaceQuery(event.currentTarget.value)}
        />
        {list.loading ? <Spinner size={16} /> : null}
      </div>

      {!list.items.length ? (
        <p className="empty-inline">
          {list.q
            ? 'no tabverse matches that filter'
            : 'no tabverses stored for this account yet'}
        </p>
      ) : (
        <div className={classes.tabverseList}>
          {list.items.map((ts) => (
            <TabverseRow
              key={ts.id}
              tabspace={ts}
              onOpen={() => void openTabspaceById(ts.id)}
            />
          ))}
        </div>
      )}

      <Pager
        total={list.total}
        offset={list.offset}
        limit={list.limit}
        onPage={(offset) => {
          pageTabspaces(offset);
          void loadTabspaces();
        }}
      />
    </div>
  );
}

function TabverseRow(props: { tabspace: TabspaceSummary; onOpen: () => void }) {
  const ts = props.tabspace;
  const counts: { n: number; label: string }[] = [
    { n: ts.notes, label: 'notes' },
    { n: ts.todos, label: 'todos' },
    { n: ts.bookmarks, label: 'bookmarks' },
    { n: ts.closed_tabs, label: 'history' },
    { n: ts.groups, label: 'groups' },
  ].filter((count) => count.n > 0);

  return (
    <button
      type="button"
      className={classes.tabverseRow}
      title={ts.id}
      onClick={props.onOpen}
    >
      <span className={classes.rowText}>
        <span className={classes.rowName}>{ts.name || '(unnamed)'}</span>
        <span className={classes.rowMeta}>
          {ts.tab_count} {plural(ts.tab_count, 'tab')} · updated{' '}
          {ago(ts.updated_at)}
        </span>
      </span>
      <span className={classes.rowCounts}>
        {counts.map((count) => (
          <span className="badge" key={count.label}>
            {count.n} {count.label}
          </span>
        ))}
      </span>
    </button>
  );
}
