import { Button, Spinner, Tag } from '@blueprintjs/core';
import React, { useState } from 'react';
import clsx from 'clsx';
import { useUnit } from 'effector-react';

import {
  changeTab,
  deleteAccount,
  renameAccount,
  revokeSessions,
  signOut,
} from '../data/actions';
import { agoIso } from '../data/format';
import {
  $account,
  $credentialsArchived,
  $tab,
  visibleCredentials,
} from '../data/stores/accounts';
import type { AccountTab } from '../data/stores/accounts';
import { $isAssumed } from '../data/stores/session';
import { $me } from '../data/stores/session';
import { PromptDialog, TypedConfirmDialog } from '../components/Dialogs';
import { CredentialsPanel } from './CredentialsPanel';
import { MembershipCard } from './MembershipCard';
import { PairCodePanel } from './PairCodePanel';
import { SearchPanel } from './SearchPanel';
import { StoredDataPanel } from './StoredDataPanel';
import classes from '../layout.module.scss';

const TABS: { id: AccountTab; label: string }[] = [
  { id: 'pair', label: 'Pair Code' },
  { id: 'credentials', label: 'Devices & Tokens' },
  { id: 'data', label: 'Stored data' },
  { id: 'search', label: 'Search' },
];

/**
 * The account view, which is the console: the four things a person does with
 * their account - add a device, look at the credentials, look at the data,
 * search it. The operator's page is not one of these tabs any more; it is its
 * own page at /console/admin (`AdminView`), reached from the header.
 *
 * The rail's notes are the same numbers the panels show, so a person can see
 * what is behind a tab without opening it.
 */
export function AccountView() {
  const { account, tab, showArchived, assumed, me } = useUnit({
    account: $account,
    tab: $tab,
    showArchived: $credentialsArchived,
    assumed: $isAssumed,
    me: $me,
  });
  // An expired membership makes the console read-only (adr/0032): the server
  // refuses the writes, and the page hides the controls rather than offering
  // an action it knows will fail.
  const readOnly = !!me?.membership?.read_only;
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [revoking, setRevoking] = useState(false);

  // An operator with no account of their own still has to reach the directory,
  // and an account that is half loaded (a reload cut short, a document from an
  // older server) must not take the page down with it - this view reads four
  // fields deep, and a blank page is the least informative thing the console
  // could do. So the frame is always drawn and the parts that need an account
  // are the parts that wait for one.
  const user = account?.user;

  // While an operator is looking through this account the header says so. It is
  // in the title and not only in the banner, because a screenshot or a "what did
  // you see" question has to carry the answer with it.
  const title =
    (user?.name || user?.id || 'Accounts') +
    (assumed && user ? ' (impersonated by admin)' : '');

  const notes: Record<AccountTab, string> = {
    pair:
      account?.devices && account.devices.length
        ? `${account.devices.length} paired`
        : account
          ? 'none yet'
          : '',
    credentials: account?.devices ? credentialsNote(account, showArchived) : '',
    data: account?.stats ? `${account.stats.live} records` : '',
    search: 'full text',
  };

  return (
    <main className={classes.content}>
      {/* The account header belongs to the account. */}
      {user ? (
        <div className={classes.viewHead}>
          <div>
            <h1>{title}</h1>
            <p className="muted small">
              {[user.id, `created ${agoIso(user.created_at)}`].join(' · ')}
            </p>
          </div>
          <div className={classes.viewActions}>
            {user.role === 'admin' ? <Tag minimal={true}>operator</Tag> : null}
            <OwnerButton
              hidden={assumed || readOnly}
              onClick={() => setRenaming(true)}
            >
              Rename
            </OwnerButton>
            <OwnerButton
              hidden={assumed || readOnly}
              intent="danger"
              icon="trash"
              onClick={() => setDeleting(true)}
            >
              Delete account
            </OwnerButton>
            <OwnerButton
              hidden={assumed}
              intent="danger"
              icon="log-out"
              onClick={() => setRevoking(true)}
            >
              Sign out everywhere
            </OwnerButton>
            <Button
              minimal={true}
              icon="log-out"
              onClick={() => void signOut()}
            >
              Sign out
            </Button>
          </div>
        </div>
      ) : null}

      <MembershipCard />

      <div className={classes.tabbed}>
        <nav className={classes.rail} aria-label="Account sections">
          {TABS.map((entry) => {
            const active = tab === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                className={clsx(classes.railItem, active && classes.railActive)}
                aria-pressed={active}
                aria-current={active ? 'page' : undefined}
                onClick={() => void changeTab(entry.id)}
              >
                <span className={classes.railLabel}>{entry.label}</span>
                <span className={classes.railNote}>{notes[entry.id]}</span>
              </button>
            );
          })}
        </nav>

        <div className={classes.panels}>
          {!account ? <Spinner size={24} /> : null}
          {account && tab === 'pair' ? <PairCodePanel /> : null}
          {account && tab === 'credentials' ? <CredentialsPanel /> : null}
          {account && tab === 'data' ? <StoredDataPanel /> : null}
          {account && tab === 'search' ? <SearchPanel /> : null}
        </div>
      </div>

      {account && user ? (
        <>
          <PromptDialog
            isOpen={renaming}
            title="Rename account"
            label="New account name"
            initial={user.name}
            onCancel={() => setRenaming(false)}
            onConfirm={async (name) => {
              setRenaming(false);
              await renameAccount(user.id, name);
            }}
          />
          <TypedConfirmDialog
            isOpen={revoking}
            title="Sign out everywhere"
            expected={user.name || user.email || user.id}
            body={
              'This ends every browser session on this account, including this ' +
              'one, and each of them has to sign in again. Use it when you think ' +
              'somebody else has been in your account.\n\n' +
              'Your paired devices keep syncing: their tokens are a separate ' +
              'credential and are not touched. Unpair them from Devices & ' +
              'Tokens if that is what you want.'
            }
            confirmLabel="Sign out everywhere"
            onCancel={() => setRevoking(false)}
            onConfirm={async () => {
              setRevoking(false);
              await revokeSessions();
            }}
          />
          <TypedConfirmDialog
            isOpen={deleting}
            title="Delete this account"
            expected={user.name || user.email || user.id}
            body={
              `Deleting ${user.name || user.email || user.id} removes the account, its ` +
              `${account.stats.total} record(s), its ${account.devices.length} ` +
              'device(s) and its tokens. ' +
              'There is no undo, and every paired device of that person stops syncing.'
            }
            onCancel={() => setDeleting(false)}
            onConfirm={async () => {
              setDeleting(false);
              if (await deleteAccount(user.id)) {
                // The console has nothing left to show without an account, and this
                // page was your own: the honest end state is the sign-in form.
                window.location.reload();
              }
            }}
          />
        </>
      ) : null}
    </main>
  );
}

/** "2 paired · 1 live": the rail's note for the credentials tab. */
function credentialsNote(
  account: NonNullable<ReturnType<typeof $account.getState>>,
  showArchived: boolean,
): string {
  // `devices` and `tokens` are lists on the wire and may be absent on a
  // document from a half-written record; an empty list is the right reading of
  // "I do not know", and it is what the tables render.
  const { devices, tokens } = visibleCredentials(account, showArchived);
  const live = tokens.filter((tok) => !tok.revoked).length;
  return `${devices.length} paired` + (live ? ` · ${live} live` : '');
}

/** An owner action: hidden rather than offered-and-refused while an operator is
 *  looking through the account, because the server refuses it anyway. */
function OwnerButton(props: {
  hidden: boolean;
  children: string;
  intent?: 'primary' | 'danger';
  icon?: 'trash' | 'edit' | 'log-out';
  onClick: () => void;
}) {
  if (props.hidden) return null;
  return (
    <Button
      intent={props.intent}
      icon={props.icon}
      onClick={props.onClick}
      text={props.children}
    />
  );
}
