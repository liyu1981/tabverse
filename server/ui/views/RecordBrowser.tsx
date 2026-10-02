import { InputGroup, Spinner, Switch } from '@blueprintjs/core';
import React, { useEffect, useRef } from 'react';
import { useUnit } from 'effector-react';

import { loadRecords } from '../data/actions';
import { ago, plural, prettyPayload } from '../data/format';
import { $account } from '../data/stores/accounts';
import {
  $records,
  pageRecords,
  setRecordDeleted,
  setRecordEntity,
  setRecordQuery,
} from '../data/stores/browse';
import type { RawRecord } from '../data/types';
import { EntitySelect } from '../components/EntitySelect';
import { Pager } from '../components/Pager';
import { useDebounced } from '../components/useDebounced';
import classes from '../data.module.scss';

/**
 * The raw record browser: the escape hatch for a record the rendered views
 * cannot make sense of. Every entity, a literal substring search over the
 * payload, tombstones hidden by default.
 */
export function RecordBrowser() {
  const { account, list } = useUnit({ account: $account, list: $records });
  const settled = useDebounced(list.q, 250);
  const firstSettle = useRef(true);

  useEffect(() => {
    if (firstSettle.current) {
      firstSettle.current = false;
      return;
    }
    void loadRecords();
  }, [settled]);

  if (!account?.user) return null;
  const who = account.user.name || account.user.id;

  return (
    <div>
      <p className="muted small">
        {who} · {list.total} raw {plural(list.total, 'record')}
        {list.entity ? ` of entity ${list.entity}` : ''}
        {list.q ? ` matching "${list.q}"` : ''}
        {list.deleted ? ' · tombstones included' : ''}
      </p>

      <div className="toolbar">
        <InputGroup
          className="grow"
          type="search"
          placeholder="substring search in payloads"
          value={list.q}
          onChange={(event) => setRecordQuery(event.currentTarget.value)}
        />
        <EntitySelect
          value={list.entity}
          onChange={(entity) => {
            setRecordEntity(entity);
            void loadRecords();
          }}
        />
        <Switch
          checked={list.deleted}
          label="show tombstones"
          onChange={(event) => {
            setRecordDeleted(event.currentTarget.checked);
            void loadRecords();
          }}
        />
        {list.loading ? <Spinner size={16} /> : null}
      </div>

      {!list.items.length ? (
        <p className="empty-inline">
          {list.q || list.entity
            ? 'no record matches'
            : 'no records stored for this account'}
        </p>
      ) : (
        <div className={classes.recordList}>
          {list.items.map((record) => (
            <RecordCard key={`${record.entity}/${record.id}`} record={record} />
          ))}
        </div>
      )}

      <Pager
        total={list.total}
        offset={list.offset}
        limit={list.limit}
        onPage={(offset) => {
          pageRecords(offset);
          void loadRecords();
        }}
      />
    </div>
  );
}

function RecordCard(props: { record: RawRecord }) {
  const rec = props.record;
  return (
    <div className={classes.record}>
      <div className={classes.recordHead}>
        <span className={classes.entity}>{rec.entity}</span>
        <span className="mono muted">{rec.id}</span>
        {rec.deleted ? <span className="badge revoked">tombstone</span> : null}
        <span className="muted small">
          rev {rec.rev} · updated {ago(rec.updated_at)}
        </span>
      </div>
      <pre className={classes.payload}>{prettyPayload(rec.payload)}</pre>
    </div>
  );
}
