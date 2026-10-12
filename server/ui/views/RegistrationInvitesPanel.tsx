import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  HTMLTable,
  InputGroup,
} from '@blueprintjs/core';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useUnit } from 'effector-react';

import { api } from '../data/api';
import { copyText } from '../components/clipboard';
import { pushToast, reportFailure } from '../data/stores/toasts';
import { $me } from '../data/stores/session';
import type {
  RegistrationInvite,
  RegistrationInviteResult,
} from '../data/types';
import classes from '../layout.module.scss';
import dataClasses from '../data.module.scss';

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
export function RegistrationInvitesPanel() {
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

  const reload = useCallback(async () => {
    try {
      setInvites(await api.listRegistrationInvites());
    } catch (error) {
      reportFailure('Loading the invitations', error);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

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
