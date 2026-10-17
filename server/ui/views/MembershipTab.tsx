import { Button, HTMLTable, Spinner, Tag } from '@blueprintjs/core';
import React, { useEffect } from 'react';
import { useUnit } from 'effector-react';

import { api } from '../data/api';
import {
  loadMeFx,
  loadSelfMembershipFx,
  renewSelfMembershipFx,
} from '../data/effects';
import { ago, until } from '../data/format';
import { $selfMembership } from '../data/stores/membership';
import { $isAssumed } from '../data/stores/session';
import type { MembershipStatus, MembershipView } from '../data/types';
import classes from '../layout.module.scss';
import dataClasses from '../data.module.scss';

const INTENT: Record<
  MembershipStatus,
  'success' | 'warning' | 'danger' | 'none'
> = {
  active: 'success',
  unlimited: 'success',
  expired: 'warning',
  closable: 'danger',
};

const LABEL: Record<MembershipStatus, string> = {
  active: 'active',
  unlimited: 'unlimited',
  expired: 'expired',
  closable: 'closing',
};

/**
 * The account's Membership tab (adr/0032): its lease, its credits, the way back
 * (renew) and the copy (download), plus the ledger behind the balance. It is the
 * account on screen's membership - resolved from the session - so it belongs
 * with the other account tabs rather than in a card of its own.
 */
export function MembershipTab() {
  const { detail, assumed, renewing } = useUnit({
    detail: $selfMembership,
    assumed: $isAssumed,
    renewing: renewSelfMembershipFx.pending,
  });

  useEffect(() => {
    void loadSelfMembershipFx();
  }, []);

  const membership = detail?.membership;

  if (!membership) {
    return (
      <section>
        <Spinner size={24} />
      </section>
    );
  }

  const canRenew =
    !assumed &&
    !membership.unlimited &&
    membership.credits >= membership.period_credits;

  const renew = async () => {
    await renewSelfMembershipFx();
    await loadSelfMembershipFx();
    await loadMeFx();
  };

  return (
    <section>
      <div className={classes.panelHead}>
        <div>
          <h2>
            Membership{' '}
            <Tag minimal={true} intent={INTENT[membership.status]}>
              {LABEL[membership.status]}
            </Tag>
          </h2>
          <p className="muted small">{describe(membership)}</p>
        </div>
        <div className={classes.panelHeadActions}>
          {membership.unlimited ? null : (
            <Button
              icon="refresh"
              loading={renewing}
              disabled={!canRenew}
              onClick={() => void renew()}
              title={
                canRenew
                  ? `Spend ${membership.period_credits} credits to add ${membership.period_days} days`
                  : 'Not enough credits to open a period'
              }
            >
              Renew
            </Button>
          )}
          <Button
            icon="download"
            onClick={() => {
              window.location.href = api.selfExportUrl();
            }}
          >
            Download my data
          </Button>
        </div>
      </div>

      {membership.read_only ? (
        <p className={classes.membershipNotice}>
          Your membership has expired, so syncing has stopped. You can still
          look at your data and download a copy during the retention window.
          Renew to start syncing again.
        </p>
      ) : null}

      <HTMLTable className={dataClasses.tableCard} striped={false}>
        <thead>
          <tr>
            <th>When</th>
            <th>Reason</th>
            <th className="right">Change</th>
            <th className="right">Balance</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {(detail.ledger || []).map((entry) => (
            <tr key={entry.id}>
              <td className="muted">{ago(entry.at)}</td>
              <td>{entry.reason}</td>
              <td className="right mono">
                {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
              </td>
              <td className="right mono">{entry.balance}</td>
              <td className="muted">{entry.detail || '—'}</td>
            </tr>
          ))}
          {(detail.ledger || []).length === 0 ? (
            <tr>
              <td colSpan={5} className="muted">
                No credit movements yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </HTMLTable>
    </section>
  );
}

function describe(m: MembershipView): string {
  if (m.status === 'unlimited') return 'unlimited; no lease or credits apply.';
  const parts: string[] = [];
  if (m.status === 'active') {
    parts.push(`renews ${until(m.expires_at)}`);
  } else {
    parts.push(`expired ${until(m.expires_at)}`);
    if (m.retention_until) {
      parts.push(`closes ${until(m.retention_until)}`);
    }
  }
  parts.push(`${m.credits} credit${m.credits === 1 ? '' : 's'}`);
  if (m.period_credits > 0) {
    parts.push(`${m.period_credits} per ${m.period_days}-day period`);
  }
  return parts.join(' · ');
}
