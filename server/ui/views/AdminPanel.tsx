import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  HTMLTable,
  InputGroup,
} from '@blueprintjs/core';
import React, { useEffect, useRef, useState } from 'react';
import { useUnit } from 'effector-react';

import { api } from '../data/api';
import { copyText } from '../components/clipboard';
import { pushToast, reportFailure } from '../data/stores/toasts';

import {
  deleteAccount,
  loadDirectory,
  revokeUserSessions,
  setUserRole,
  startImpersonation,
} from '../data/actions';
import { ago } from '../data/format';
import {
  $directoryQuery,
  $users,
  setDirectoryQuery,
} from '../data/stores/accounts';
import { $me } from '../data/stores/session';
import type {
  RegistrationInvite,
  RegistrationInviteResult,
  UserSummary,
} from '../data/types';
import { ConfirmDialog, TypedConfirmDialog } from '../components/Dialogs';
import { useDebounced } from '../components/useDebounced';
import classes from '../layout.module.scss';
import dataClasses from '../data.module.scss';

type Pending =
  | { kind: 'role'; user: UserSummary; role: string }
  | { kind: 'delete'; user: UserSummary }
  | { kind: 'impersonate'; user: UserSummary }
  | { kind: 'revoke'; user: UserSummary }
  | null;

/**
 * The operator's Admin tab: every account, and what can be done to it.
 *
 * A table rather than a card list, because these are rows an operator *acts* on
 * and the numbers beside the name - devices, records, last active - are how they
 * decide which row to act on.
 *
 * There is no "create account" here, on purpose: registration is the only way an
 * account comes into existence, because it is the only path that can prove an
 * address (adr/0014).
 */
export function AdminPanel() {
  const { users, query, me } = useUnit({
    users: $users,
    query: $directoryQuery,
    me: $me,
  });
  const [pending, setPending] = useState<Pending>(null);

  // The filter is typed into on every keystroke and asked for once it settles:
  // a list of accounts is unusable without it, and a request per character is
  // not what a server on a LAN needs. The first settle is the value the panel
  // opened with, which the tab switch already loaded.
  const settledQuery = useDebounced(query, 200);
  const firstSettle = useRef(true);
  useEffect(() => {
    if (firstSettle.current) {
      firstSettle.current = false;
      return;
    }
    void loadDirectory();
  }, [settledQuery]);

  const total = users.length;
  const ask = (next: NonNullable<Pending>) => setPending(next);

  const run = async () => {
    const job = pending;
    setPending(null);
    if (!job) return;
    // `role` only exists on the role question; the confirm below asks about
    // exactly one job at a time.
    if (job.kind === 'role') {
      await setUserRole(job.user.id, job.role);
      return;
    }
    if (job.kind === 'impersonate') {
      await startImpersonation(job.user.id);
      return;
    }
    if (job.kind === 'revoke') {
      await revokeUserSessions(job.user.id);
      return;
    }
    if (await deleteAccount(job.user.id)) {
      await loadDirectory();
    }
  };

  return (
    <section>
      <div className={classes.panelHead}>
        <div>
          <h2>Accounts</h2>
          <p className="muted small">
            {total === 0
              ? 'No accounts yet - people appear here when they register.'
              : `${total} account${total === 1 ? '' : 's'} on this server.`}
          </p>
        </div>
      </div>

      <div className="toolbar">
        <InputGroup
          className="grow"
          type="search"
          placeholder="filter by name or email"
          value={query}
          disabled={total === 0}
          onChange={(event) => setDirectoryQuery(event.currentTarget.value)}
        />
      </div>

      {total === 0 ? (
        <div className={dataClasses.emptyCard}>
          No accounts yet. Give somebody this server's address and let them
          register - that is how an account is created.
        </div>
      ) : (
        <HTMLTable className={dataClasses.tableCard} striped={false}>
          <thead>
            <tr>
              <th>Account</th>
              <th>Email</th>
              <th className="right">Devices</th>
              <th className="right">Records</th>
              <th>Last active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isSelf = me?.user_id === user.id;
              return (
                <tr key={user.id}>
                  <td>
                    <div>
                      {user.name || '(unnamed)'}
                      {user.role === 'admin' ? (
                        <span className="badge">operator</span>
                      ) : null}
                    </div>
                    <div className="mono muted">{user.id}</div>
                  </td>
                  <td className="muted">{user.email || '—'}</td>
                  <td className="right muted">{user.device_count ?? 0}</td>
                  <td className="right muted">{user.record_count ?? 0}</td>
                  <td className="muted">{ago(user.last_activity)}</td>
                  <td>
                    <div className="actions">
                      <RowActions
                        user={user}
                        isSelf={isSelf}
                        isOperator={me?.role === 'admin'}
                        onAsk={ask}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </HTMLTable>
      )}

      <p className="muted small" style={{ marginTop: 12 }}>
        Accounts are created by registering, not from here: an operator could
        only make an account nobody can prove they own.
      </p>

      <RegistrationInvitesPanel />

      <ConfirmDialog
        isOpen={
          pending?.kind === 'impersonate' ||
          pending?.kind === 'role' ||
          pending?.kind === 'revoke'
        }
        title={
          pending?.kind === 'impersonate'
            ? 'Look at this account as its owner?'
            : pending?.kind === 'revoke'
              ? 'Sign this account out everywhere?'
              : pending?.kind === 'role' && pending.role === 'admin'
                ? 'Make this person an operator?'
                : 'Take operator access away?'
        }
        intent={pending?.kind === 'revoke' ? 'danger' : undefined}
        body={
          pending?.kind === 'impersonate'
            ? 'Read only: nothing can be changed while you do, and both the start and the stop are recorded. The window is 15 minutes.'
            : pending?.kind === 'revoke'
              ? `End every browser session on ${pending.user.name || pending.user.email || pending.user.id}?\n\n` +
                'Each of them has to sign in again, and you will be signed out of nothing - this is their account, not yours. Use it when you think a session of theirs was stolen.\n\n' +
                'Their devices keep syncing: those tokens are a different credential and are not touched.'
              : pending?.kind === 'role'
                ? pending.role === 'admin'
                  ? `Make ${pending.user.name || pending.user.email} an operator?\n\nThey will be able to see every account on this server, mint pairing codes for anyone, and look through other accounts read only.`
                  : `Take operator access away from ${pending.user.name || pending.user.email}?\n\nThey keep their own account, devices and data.`
                : ''
        }
        onCancel={() => setPending(null)}
        onConfirm={run}
      />

      <TypedConfirmDialog
        isOpen={pending?.kind === 'delete'}
        title="Delete this account"
        expected={
          pending?.kind === 'delete'
            ? pending.user.name || pending.user.email || pending.user.id
            : ''
        }
        body={
          pending?.kind === 'delete'
            ? `Deleting ${pending.user.name || pending.user.email || pending.user.id} removes the account, its ${pending.user.record_count ?? 0} record(s), its devices and its tokens. There is no undo.`
            : ''
        }
        onCancel={() => setPending(null)}
        onConfirm={run}
      />
    </section>
  );
}

/**
 * The powers an operator has over one row. The controls differ by role and by
 * who is looking, because "delete" means something different when it is your
 * own account - and operators cannot be looked through at all, so the button is
 * not offered rather than offered and refused.
 */
function RowActions(props: {
  user: UserSummary;
  isSelf: boolean;
  isOperator: boolean;
  onAsk: (pending: NonNullable<Pending>) => void;
}) {
  const { user, isSelf, isOperator } = props;
  if (!isOperator) {
    return <span className="muted small">your account</span>;
  }
  if (isSelf) {
    return <span className="muted small">this is you</span>;
  }
  return (
    <>
      {user.role === 'admin' ? (
        <span
          className="muted small"
          title="an operator cannot look through another operator"
        >
          operator
        </span>
      ) : (
        <Button
          small={true}
          minimal={true}
          onClick={() => props.onAsk({ kind: 'impersonate', user })}
        >
          Impersonate
        </Button>
      )}
      <Button
        small={true}
        minimal={true}
        onClick={() =>
          props.onAsk({
            kind: 'role',
            user,
            role: user.role === 'admin' ? 'user' : 'admin',
          })
        }
      >
        {user.role === 'admin' ? 'Remove operator' : 'Make operator'}
      </Button>
      <Button
        small={true}
        minimal={true}
        title="End every browser session on this account. Their devices keep syncing - those tokens are a different credential."
        onClick={() => props.onAsk({ kind: 'revoke', user })}
      >
        Sign out everywhere
      </Button>
      <Button
        small={true}
        minimal={true}
        intent="danger"
        onClick={() => props.onAsk({ kind: 'delete', user })}
      >
        Delete
      </Button>
    </>
  );
}

/**
 * The operator's control over who may register on an invite-only server
 * (TABVERSED_REGISTRATION_REQUIRES_INVITE).
 *
 * The whole life of an invite is here: create one (with an optional code, and
 * optionally mailed), copy the message when there is no SMTP, re-send it, and
 * revoke it. The message text is the server's - `renderRegistrationInvite`
 * echoes what Go wrote - so a deployment with mail and one without send the
 * same thing.
 */
function RegistrationInvitesPanel() {
  const me = useUnit($me);
  // Whether the server can actually post mail, which decides whether "send the
  // email" can mean anything.
  const canEmail = me?.smtp === true;
  const [invites, setInvites] = useState<RegistrationInvite[]>([]);
  const [email, setEmail] = useState('');
  const [withCode, setWithCode] = useState(false);
  const [sendEmail, setSendEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [template, setTemplate] = useState<RegistrationInviteResult | null>(
    null,
  );
  // A deployment with a mail server sends the invitation by default; one
  // without cannot, so the box is off and the template is the thing to copy.
  // Set once, so unticking it sticks.
  const defaultedSend = useRef(false);
  useEffect(() => {
    if (!defaultedSend.current && canEmail) {
      defaultedSend.current = true;
      setSendEmail(true);
    }
  }, [canEmail]);

  const reload = async () => {
    try {
      setInvites(await api.listRegistrationInvites());
    } catch (error) {
      reportFailure('Loading the invitations', error);
    }
  };
  useEffect(() => {
    void reload();
  }, []);

  const invite = async () => {
    const address = email.trim().toLowerCase();
    if (!address) return;
    setBusy(true);
    try {
      const result = await api.inviteRegistration({
        email: address,
        with_code: withCode,
        send_email: sendEmail,
      });
      setEmail('');
      setTemplate(result);
      pushToast({ message: `Invited ${address}`, kind: 'good' });
      await reload();
    } catch (error) {
      reportFailure('Inviting', error);
    } finally {
      setBusy(false);
    }
  };

  const resend = async (address: string) => {
    try {
      setTemplate(await api.sendRegistrationInvite(address));
      await reload();
    } catch (error) {
      reportFailure('Sending the invitation', error);
    }
  };

  const revoke = async (address: string) => {
    try {
      await api.revokeRegistrationInvite(address);
      pushToast({ message: `Revoked the invite for ${address}`, kind: 'good' });
      await reload();
    } catch (error) {
      reportFailure('Revoking the invitation', error);
    }
  };

  const statusOf = (inv: RegistrationInvite): string => {
    if (inv.used_at) return 'used';
    if (inv.expires_at && inv.expires_at < Date.now()) return 'expired';
    return 'pending';
  };

  const copy = async () => {
    if (!template) return;
    const text = `${template.email.subject}\n\n${template.email.body}`;
    if (await copyText(text)) {
      pushToast({ message: 'Invitation copied', kind: 'good' });
    } else {
      pushToast({
        message: 'Copying was blocked — select the text and press Ctrl+C',
        kind: 'bad',
      });
    }
  };

  return (
    <section style={{ marginTop: 32 }}>
      <div className={classes.panelHead}>
        <div>
          <h2>Registration invites</h2>
          <p className="muted small">
            When the server is invite-only, an account is created only for an
            address invited here. Invite one, copy or send the message, and
            revoke it if you change your mind.
          </p>
        </div>
      </div>

      <div className="toolbar">
        <InputGroup
          className="grow"
          type="email"
          placeholder="name@example.com"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
        <Checkbox
          checked={withCode}
          label="Require a code"
          onChange={(event) => setWithCode(event.currentTarget.checked)}
        />
        <Checkbox
          checked={sendEmail}
          disabled={!canEmail}
          label="Send the email"
          title={
            canEmail
              ? "Deliver the invitation through this server's mail settings"
              : 'No mail server is configured - copy the email instead'
          }
          onChange={(event) => setSendEmail(event.currentTarget.checked)}
        />
        <Button intent="primary" loading={busy} onClick={invite}>
          Invite
        </Button>
      </div>

      {invites.length === 0 ? (
        <div className={dataClasses.emptyCard}>No invitations yet.</div>
      ) : (
        <HTMLTable className={dataClasses.tableCard} striped={false}>
          <thead>
            <tr>
              <th>Email</th>
              <th>Status</th>
              <th>Expires</th>
              <th>Code</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {invites.map((inv) => (
              <tr key={inv.email}>
                <td>{inv.email}</td>
                <td className="muted">{statusOf(inv)}</td>
                <td className="muted">
                  {inv.expires_at
                    ? new Date(inv.expires_at).toLocaleString()
                    : 'never'}
                </td>
                <td className="muted">{inv.has_code ? 'required' : '—'}</td>
                <td>
                  <div className="actions">
                    <Button
                      small={true}
                      minimal={true}
                      onClick={() => resend(inv.email)}
                    >
                      Send email
                    </Button>
                    <Button
                      small={true}
                      minimal={true}
                      intent="danger"
                      onClick={() => revoke(inv.email)}
                    >
                      Revoke
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </HTMLTable>
      )}

      <Dialog
        isOpen={template !== null}
        onClose={() => setTemplate(null)}
        title="Invitation email"
        icon="envelope"
      >
        <DialogBody>
          {template ? (
            <>
              <p className="muted small">
                Copy this and send it to the address, or turn on "Send the
                email" to have the server deliver it.
              </p>
              {template.code ? (
                <p>
                  Code: <span className="mono">{template.code}</span>
                </p>
              ) : null}
              <p>
                <strong>{template.email.subject}</strong>
              </p>
              <pre style={{ whiteSpace: 'pre-wrap' }}>
                {template.email.body}
              </pre>
              <Button intent="primary" onClick={copy}>
                Copy the email
              </Button>
            </>
          ) : null}
        </DialogBody>
      </Dialog>
    </section>
  );
}
