import { Button, Tag } from '@blueprintjs/core';
import React from 'react';
import { useUnit } from 'effector-react';

import { api } from '../data/api';
import { loadMeFx, renewSelfMembershipFx } from '../data/effects';
import { until } from '../data/format';
import { $me } from '../data/stores/session';
import type { MembershipStatus, MembershipView } from '../data/types';
import classes from '../layout.module.scss';

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
 * The signed-in account's membership card (adr/0032). It is the one place a
 * person learns their lease is running out, and - once it has - the place that
 * offers the way back (renew) and the copy (download). It renders nothing at all
 * when the system is off, so a self-hosted deployment is unchanged.
 */
export function MembershipCard() {
  const me = useUnit($me);
  const renewing = useUnit(renewSelfMembershipFx.pending);
  const membership = me?.membership;
  if (!membership || !membership.enabled) return null;

  const renew = async () => {
    await renewSelfMembershipFx();
    await loadMeFx();
  };

  return (
    <section className={classes.membershipCard}>
      <div className={classes.membershipHead}>
        <div>
          <h3>
            Membership{' '}
            <Tag minimal={true} intent={INTENT[membership.status]}>
              {LABEL[membership.status]}
            </Tag>
          </h3>
          <p className="muted small">{describe(membership)}</p>
        </div>
        <div className={classes.viewActions}>
          <Button
            icon="refresh"
            loading={renewing}
            onClick={() => void renew()}
            title="Spend credits to open another period"
          >
            Renew
          </Button>
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
