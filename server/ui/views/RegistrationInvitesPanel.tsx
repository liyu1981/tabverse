import {
  Button,
  Collapse,
  Dialog,
  DialogBody,
  HTMLTable,
  Icon,
  InputGroup,
  TextArea,
} from '@blueprintjs/core';
import React, { useCallback, useEffect, useState } from 'react';
import { useUnit } from 'effector-react';

import { api } from '../data/api';
import { copyText } from '../components/clipboard';
import { pushToast, reportFailure } from '../data/stores/toasts';
import { $me } from '../data/stores/session';
import type {
  RegistrationInvite,
  RegistrationInviteResult,
  UserSummary,
} from '../data/types';
import classes from '../layout.module.scss';
import dataClasses from '../data.module.scss';

/**
 * The operator's control over who may register on an invite-only server
 * (TABVERSED_REGISTRATION_REQUIRES_INVITE).
 *
 * Two sections: the requests from people who asked for an invitation on the
 * register page, then the invites the operator makes by hand. Approving a
 * request mints the invitation and drops the request; the person registers with
 * the code like anybody else. Nothing sends mail on its own - a click on a row
 * opens a dialog with the two ways to deliver the invitation: send it through
 * the server, or copy the drafted message and send it yourself.
 */
export function RegistrationInvitesPanel() {
  const me = useUnit($me);
  // Which transport the server would use, and whether it can send at all.
  const transport = me?.mail_transport || '';
  const canSend = transport !== '';
  const sendLabel = transport === 'resend' ? 'Send with Resend' : 'Send email';

  // People who logged in without an invitation: the requests to approve.
  const [requests, setRequests] = useState<UserSummary[]>([]);
  const [invites, setInvites] = useState<RegistrationInvite[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  // The dialog is for one address, and the drafts cache holds the rendered
  // message from the last create, approve or send for it.
  const [dialogEmail, setDialogEmail] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<
    Record<string, RegistrationInviteResult>
  >({});
  const [sendOpen, setSendOpen] = useState(true);
  const [copyOpen, setCopyOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [nextInvites, nextRequests] = await Promise.all([
        api.listRegistrationInvites(),
        api.listRegistrationRequests(),
      ]);
      setInvites(nextInvites);
      setRequests(nextRequests);
    } catch (error) {
      reportFailure('Loading the invitations', error);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const openDialog = (address: string) => {
    setDialogEmail(address);
    // The manual section is the first one and the draft is the point, so it
    // opens; the send section opens too, because sending is one click away.
    setCopyOpen(true);
    setSendOpen(true);
  };

  const remember = (result: RegistrationInviteResult) => {
    setDrafts((prev) => ({ ...prev, [result.invite.email]: result }));
  };

  // Creating an invite records it and opens the dialog; it sends nothing.
  const invite = async () => {
    const address = email.trim().toLowerCase();
    if (!address) return;
    setBusy(true);
    try {
      const result = await api.inviteRegistration({ email: address });
      setEmail('');
      remember(result);
      pushToast({ message: `Invited ${address}`, kind: 'good' });
      await reload();
      openDialog(result.invite.email);
    } catch (error) {
      reportFailure('Inviting', error);
    } finally {
      setBusy(false);
    }
  };

  // The one action that sends, and it says what happened. The body is the
  // drafted message from the manual section above - the server does not
  // re-render it.
  const send = async (
    address: string,
    message: { subject: string; text: string },
  ) => {
    try {
      const result = await api.sendRegistrationInvite(address, message);
      remember(result);
      pushToast({ message: `Invitation sent to ${address}`, kind: 'good' });
      await reload();
    } catch (error) {
      reportFailure('Sending the invitation', error);
    }
  };

  const revoke = async (address: string) => {
    try {
      await api.revokeRegistrationInvite(address);
      pushToast({ message: `Revoked the invite for ${address}`, kind: 'good' });
      if (dialogEmail === address) setDialogEmail(null);
      await reload();
    } catch (error) {
      reportFailure('Revoking the invitation', error);
    }
  };

  // Approving mints an invitation for the address and drops the placeholder; it
  // does not send. The person still registers with the code.
  const approveRequest = async (request: UserSummary) => {
    const who = request.email || request.id;
    try {
      const result = await api.inviteRegistrationRequest(request.id);
      remember(result);
      pushToast({ message: `Invited ${who}`, kind: 'good' });
      await reload();
      openDialog(result.invite.email);
    } catch (error) {
      reportFailure('Inviting', error);
    }
  };

  const rejectRequest = async (request: UserSummary) => {
    const who = request.email || request.id;
    try {
      await api.deleteRegistrationRequest(request.id);
      pushToast({ message: `Removed the request from ${who}`, kind: 'good' });
      await reload();
    } catch (error) {
      reportFailure('Removing the request', error);
    }
  };

  const statusOf = (inv: RegistrationInvite): string => {
    if (inv.used_at) return 'used';
    if (inv.expires_at && inv.expires_at < Date.now()) return 'expired';
    return 'pending';
  };

  const current = dialogEmail
    ? invites.find((candidate) => candidate.email === dialogEmail)
    : undefined;
  const draft = dialogEmail ? drafts[dialogEmail] : null;
  // The stored message is the draft, and it is there the moment the dialog
  // opens - no waiting for a send. A cached create/approve/send response wins
  // when present, because a coded invite's code changes when it is re-sent.
  const subject = draft?.email.subject || current?.email_subject || '';
  const body = draft?.email.body || current?.email_body || '';
  const draftText = subject && body ? `${subject}\n\n${body}` : '';

  const copy = async () => {
    if (!draftText) return;
    if (await copyText(draftText)) {
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
            address invited here. People who log in without an invitation appear
            below as requests, to approve or remove.
          </p>
        </div>
      </div>

      <h3>Requests</h3>
      {requests.length === 0 ? (
        <div className={dataClasses.emptyCard}>
          No pending requests. A social login with no invitation shows up here.
        </div>
      ) : (
        <HTMLTable className={dataClasses.tableCard} striped={false}>
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Requested</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id}>
                <td>{request.email || '—'}</td>
                <td className="muted">{request.name || '—'}</td>
                <td className="muted">
                  {request.pending_at
                    ? new Date(request.pending_at).toLocaleString()
                    : '—'}
                </td>
                <td>
                  <div className="actions">
                    <Button
                      small={true}
                      minimal={true}
                      intent="primary"
                      onClick={() => approveRequest(request)}
                    >
                      Invite
                    </Button>
                    <Button
                      small={true}
                      minimal={true}
                      intent="danger"
                      onClick={() => rejectRequest(request)}
                    >
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </HTMLTable>
      )}

      <h3>Invite an address</h3>
      <div className="toolbar">
        <InputGroup
          className="grow"
          type="email"
          placeholder="name@example.com"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
        <Button intent="primary" loading={busy} onClick={invite}>
          Create invite
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
                <td>
                  <div className="actions">
                    <Button
                      small={true}
                      minimal={true}
                      intent="primary"
                      onClick={() => openDialog(inv.email)}
                    >
                      Send
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
        isOpen={dialogEmail !== null}
        onClose={() => setDialogEmail(null)}
        title={dialogEmail ? `Invitation for ${dialogEmail}` : 'Invitation'}
        icon="envelope"
      >
        <DialogBody>
          <FoldSection
            title="Manual copy & send"
            isOpen={copyOpen}
            onToggle={() => setCopyOpen((open) => !open)}
          >
            <Button icon="clipboard" onClick={copy} disabled={!draftText}>
              Copy email
            </Button>
            <TextArea
              className={dataClasses.draftText}
              readOnly={true}
              value={
                draftText ||
                'The invitation has no stored message yet; create it again to draft one.'
              }
              rows={12}
              fill={true}
            />
          </FoldSection>

          <FoldSection
            title={sendLabel}
            isOpen={sendOpen}
            onToggle={() => setSendOpen((open) => !open)}
          >
            {canSend ? (
              <>
                <p className="muted small">
                  Send the drafted message above through this server's mail
                  settings.
                </p>
                <Button
                  intent="primary"
                  icon="send-message"
                  disabled={!draftText}
                  onClick={() =>
                    dialogEmail && send(dialogEmail, { subject, text: body })
                  }
                >
                  {sendLabel}
                </Button>
              </>
            ) : (
              <p className="muted small">
                No mail transport is configured, so the server cannot send it.
                Use the manual copy above.
              </p>
            )}
          </FoldSection>
        </DialogBody>
      </Dialog>
    </section>
  );
}

/**
 * One collapsible section of the dialog: a header that toggles, and its body.
 * Blueprint's `Collapse` does the animation; the header is ours so the caret
 * and the wording are the same as the note tool's.
 */
function FoldSection(props: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={dataClasses.foldSection}>
      <button
        type="button"
        className="bp6-button bp6-minimal"
        aria-expanded={props.isOpen}
        onClick={props.onToggle}
      >
        <Icon icon={props.isOpen ? 'caret-down' : 'caret-right'} />
        <span style={{ marginLeft: 6 }}>{props.title}</span>
      </button>
      <Collapse isOpen={props.isOpen} keepChildrenMounted={false}>
        <div className={dataClasses.foldBody}>{props.children}</div>
      </Collapse>
    </div>
  );
}
