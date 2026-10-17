import { Button, HTMLTable, InputGroup, Switch, Tag } from '@blueprintjs/core';
import React, { useEffect, useState } from 'react';
import { useUnit } from 'effector-react';

import {
  closeMembershipFx,
  extendMembershipFx,
  grantCreditsFx,
  loadMembershipSettingsFx,
  loadMembershipsFx,
  setMembershipSettingsFx,
  setMembershipUnlimitedFx,
} from '../data/effects';
import { until } from '../data/format';
import {
  $membershipEnabled,
  $membershipQuery,
  $memberships,
  $membershipSettings,
  setMembershipQuery,
} from '../data/stores/membership';
import type { MembershipStatus, MembershipSummary } from '../data/types';
import { ConfirmDialog } from '../components/Dialogs';
import { useDebounced } from '../components/useDebounced';
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

type Pending = { kind: 'close'; user: MembershipSummary } | null;

/**
 * The operator's Membership tab (adr/0032): the master switch, and every
 * account's lease and balance. This is "view and manage" in one place - grant
 * credits, extend a period, mark an account unlimited, or close a lapsed one
 * before its retention window would.
 */
export function MembershipPanel() {
  const { memberships, enabled, settings, query } = useUnit({
    memberships: $memberships,
    enabled: $membershipEnabled,
    settings: $membershipSettings,
    query: $membershipQuery,
  });
  const [pending, setPending] = useState<Pending>(null);

  useEffect(() => {
    void loadMembershipSettingsFx();
  }, []);

  const settled = useDebounced(query, 200);
  useEffect(() => {
    void loadMembershipsFx(settled);
  }, [settled]);

  const reload = () => void loadMembershipsFx(undefined);

  return (
    <section>
      <div className={classes.panelHead}>
        <div>
          <h2>Membership</h2>
          <p className="muted small">
            {enabled
              ? 'A period is funded by credits; a lapsed account is kept for a while, read only, before it closes.'
              : 'The membership system is off, so every account is unlimited.'}
          </p>
        </div>
        <Switch
          checked={enabled}
          label="Membership enabled"
          onChange={(event) =>
            void setMembershipSettingsFx(event.currentTarget.checked)
          }
        />
      </div>

      {settings ? (
        <p className="muted small">
          {settings.period_days}-day period · {settings.period_credits} credits
          · trial {settings.trial_credits} · retention {settings.retention_days}
          d · {settings.auto_purge ? 'auto-close on' : 'auto-close off'}
        </p>
      ) : null}

      <div className="toolbar">
        <InputGroup
          className="grow"
          type="search"
          placeholder="filter by name or email"
          value={query}
          onChange={(event) => setMembershipQuery(event.currentTarget.value)}
        />
      </div>

      {memberships.length === 0 ? (
        <div className={dataClasses.emptyCard}>No accounts yet.</div>
      ) : (
        <HTMLTable className={dataClasses.tableCard} striped={false}>
          <thead>
            <tr>
              <th>Account</th>
              <th>Status</th>
              <th className="right">Credits</th>
              <th>Lease</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {memberships.map((m) => (
              <tr key={m.user_id}>
                <td>
                  <div>{m.name || '(unnamed)'}</div>
                  <div className="mono muted">{m.email || m.user_id}</div>
                </td>
                <td>
                  <Tag minimal={true} intent={INTENT[m.status]}>
                    {m.status}
                  </Tag>
                </td>
                <td className="right muted">{m.credits}</td>
                <td className="muted">
                  {m.unlimited
                    ? 'unlimited'
                    : m.expires_at
                      ? until(m.expires_at)
                      : 'never opened'}
                </td>
                <td>
                  <div className="actions">
                    <Button
                      small={true}
                      minimal={true}
                      onClick={() =>
                        void grantCreditsFx({
                          userId: m.user_id,
                          delta: 30,
                        }).then(reload)
                      }
                    >
                      +30 credits
                    </Button>
                    <Button
                      small={true}
                      minimal={true}
                      onClick={() =>
                        void extendMembershipFx({
                          userId: m.user_id,
                          periods: 1,
                          useCredits: false,
                        }).then(reload)
                      }
                    >
                      +1 period
                    </Button>
                    <Button
                      small={true}
                      minimal={true}
                      onClick={() =>
                        void setMembershipUnlimitedFx({
                          userId: m.user_id,
                          unlimited: !m.unlimited,
                        }).then(reload)
                      }
                    >
                      {m.unlimited ? 'Remove unlimited' : 'Make unlimited'}
                    </Button>
                    <Button
                      small={true}
                      minimal={true}
                      intent="danger"
                      onClick={() => setPending({ kind: 'close', user: m })}
                    >
                      Close
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </HTMLTable>
      )}

      <ConfirmDialog
        isOpen={pending?.kind === 'close'}
        title="Close this account now?"
        intent="danger"
        body={
          pending?.kind === 'close'
            ? `Closing ${pending.user.name || pending.user.email || pending.user.user_id} removes the account, its records, its devices and its tokens. It is what the retention window does automatically; doing it now skips the window and any chance to download. There is no undo.`
            : ''
        }
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          const job = pending;
          setPending(null);
          if (job) {
            await closeMembershipFx(job.user.user_id);
            reload();
          }
        }}
      />
    </section>
  );
}
