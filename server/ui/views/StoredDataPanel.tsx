import { Switch } from '@blueprintjs/core';
import React from 'react';
import { useUnit } from 'effector-react';

import { changeDataView, toggleDataArchived } from '../data/actions';
import {
  $account,
  $dataArchived,
  $dataView,
  type StoredDataView,
} from '../data/stores/accounts';
import { Segmented } from '../components/Pager';
import { RecordBrowser } from './RecordBrowser';
import { SearchPanel } from './SearchPanel';
import { TabverseList } from './TabverseList';
import classes from '../layout.module.scss';

const VIEWS: { value: StoredDataView; label: string }[] = [
  { value: 'tabverses', label: 'Tabverses' },
  { value: 'search', label: 'Search' },
  { value: 'records', label: 'Records' },
];

/**
 * The stored data panel: what this account has, in three ways.
 *
 * The counters belong to the panel they describe, and the "show archived"
 * toggle belongs to all three views at once - archived rows are hidden from the
 * tabverse list, the record browser and the search alike, so the toggle cannot
 * live in any one of their toolbars without two of the three disagreeing about
 * what is visible (adr/0011).
 */
export function StoredDataPanel() {
  const { account, view, archived } = useUnit({
    account: $account,
    view: $dataView,
    archived: $dataArchived,
  });
  const stats = account?.stats;
  const archivedRecords = (account?.devices ?? []).reduce(
    (n, dev) => n + dev.archived_records,
    0,
  );

  if (!account?.user) return null;

  const byEntity = Object.entries(stats?.by_entity ?? {}).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <section>
      <div className={classes.panelHead}>
        <div>
          <h2>Stored data</h2>
          <p className="muted small">
            Read only: the extension's copy of a record wins any conflict, so a
            record written from here would be overwritten by the next honest
            sync.
          </p>
        </div>
        <div className={classes.panelHeadActions}>
          <Switch
            checked={archived}
            label="show archived"
            onChange={(event) =>
              void toggleDataArchived(event.currentTarget.checked)
            }
          />
          <Segmented
            ariaLabel="Stored data views"
            value={view}
            options={VIEWS}
            onChange={(next) => void changeDataView(next)}
          />
        </div>
      </div>

      <div className="stat-row">
        <div className="stat">
          <div className="v">{stats?.live ?? 0}</div>
          <div className="k">records</div>
        </div>
        {stats && stats.total > stats.live ? (
          <div className="stat">
            <div className="v">{stats.total - stats.live}</div>
            <div className="k">tombstones</div>
          </div>
        ) : null}
        {archivedRecords ? (
          <div className="stat">
            <div className="v">{archivedRecords}</div>
            <div className="k">archived</div>
          </div>
        ) : null}
        <div className="stat">
          <div className="v">{stats?.rev_seq ?? 0}</div>
          <div className="k">server rev</div>
        </div>
        {byEntity.map(([entity, count]) => (
          <div className="stat" key={entity}>
            <div className="v">{count}</div>
            <div className="k">{entity}</div>
          </div>
        ))}
      </div>

      {view === 'tabverses' ? <TabverseList /> : null}
      {view === 'records' ? <RecordBrowser /> : null}
      {view === 'search' ? <SearchPanel /> : null}
    </section>
  );
}
