import React, { useState } from 'react';
import clsx from 'clsx';

import { AdminPanel } from './AdminPanel';
import { RegistrationInvitesPanel } from './RegistrationInvitesPanel';
import classes from '../layout.module.scss';

type AdminTab = 'accounts' | 'invites';

const TABS: { id: AdminTab; label: string }[] = [
  { id: 'accounts', label: 'Accounts' },
  { id: 'invites', label: 'Registration invites' },
];

/**
 * The operator's page, at /console/admin (adr/0024).
 *
 * It is a page of its own rather than a tab of the account console: it is not
 * about the signed-in account at all, and a rail of its own leaves room for the
 * sections that only make sense to an operator - the accounts, and who may
 * register. Reached from the header; `App` renders a notice instead for anyone
 * who is not an operator.
 */
export function AdminView() {
  const [tab, setTab] = useState<AdminTab>('accounts');
  return (
    <main className={classes.content}>
      <div className={classes.viewHead}>
        <div>
          <h1>Admin</h1>
          <p className="muted small">
            The accounts on this server, and who may register.
          </p>
        </div>
      </div>

      <div className={classes.tabbed}>
        <nav className={classes.rail} aria-label="Admin sections">
          {TABS.map((entry) => {
            const active = tab === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                className={clsx(classes.railItem, active && classes.railActive)}
                aria-pressed={active}
                aria-current={active ? 'page' : undefined}
                onClick={() => setTab(entry.id)}
              >
                <span className={classes.railLabel}>{entry.label}</span>
              </button>
            );
          })}
        </nav>

        <div className={classes.panels}>
          {tab === 'accounts' ? <AdminPanel /> : null}
          {tab === 'invites' ? <RegistrationInvitesPanel /> : null}
        </div>
      </div>
    </main>
  );
}
