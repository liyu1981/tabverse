import { Button, Card, Checkbox, FormGroup } from '@blueprintjs/core';
import React, { useState } from 'react';
import { useUnit } from 'effector-react';

import { registerAccount } from '../data/actions';
import { $me } from '../data/stores/session';
import { providerLabel } from '../components/ProviderMark';
import classes from '../layout.module.scss';

/**
 * The register page.
 *
 * A provider login whose subject has no account lands here instead of being
 * turned into one silently (adr/0029). The email is required - it is what the
 * account is identified by, and the server fills it in already when the login
 * carried one (a social provider's address, or the address a sign-in link was
 * sent to). The agreement is the second thing the old one-step flow never asked
 * for. On success the server signs the pending session out and this page gives
 * way to the sign-in form.
 *
 * The invitation code field appears only when it applies: never when the server
 * does not gate registration on an invitation, and never for the operator's own
 * address, which is exempt so the first operator can always register (adr/0013).
 * When it does apply the code is required; somebody with no code can request an
 * invitation instead.
 */
export function RegisterView() {
  const me = useUnit($me);
  const registration = me?.registration;
  const provider = registration?.provider || '';
  const [email, setEmail] = useState(registration?.email || '');
  const [code, setCode] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const adminEmail = me?.admin_email || '';
  const emailIsAdmin =
    adminEmail !== '' &&
    email.trim().toLowerCase() === adminEmail.toLowerCase();
  const showCode = me?.invite_required === true && !emailIsAdmin;

  const run = async (request: boolean) => {
    if (!email.trim() || !agree) return;
    if (!request && showCode && !code.trim()) return;
    setBusy(true);
    setError('');
    const done = await registerAccount(
      email,
      agree,
      request ? undefined : code,
      request,
    );
    setBusy(false);
    if (!done.ok) {
      setError(
        request
          ? 'The invitation could not be requested. Try again in a moment.'
          : 'The account could not be created. Check the invitation code and try again.',
      );
    }
    // On success the server signed the session out and `sessionExpired` has
    // already switched the console back to the sign-in form.
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void run(false);
  };

  // The agreement has to be readable before it is accepted. An official build
  // serves it at /terms from the embedded documentation; a build without the
  // docs (adr/0024) falls back to the source in the repository.
  const termsHref = me?.docs
    ? '/terms'
    : 'https://github.com/liyu1981/tabverse/blob/main/doc/tabverse-website/src/pages/terms.md';

  return (
    <main className={classes.signin}>
      <Card className={classes.signinCard}>
        <h1>Create your account</h1>
        <p className="muted">
          {provider
            ? `You signed in with ${providerLabel(provider)}. One more step and this server has an account for you.`
            : 'One more step and this server has an account for you.'}
        </p>
        <form onSubmit={submit}>
          <FormGroup
            label="Email"
            labelFor="register-email"
            helperText="Required. This is how you sign in and how this server identifies you."
          >
            <input
              id="register-email"
              type="email"
              required={true}
              autoComplete="email"
              spellCheck={false}
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
          </FormGroup>
          {showCode ? (
            <FormGroup
              label="Invitation code (required)"
              labelFor="register-code"
              helperText="This server is invite-only. Ask the operator for a code, or request one below."
            >
              <input
                id="register-code"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                value={code}
                onChange={(event) => setCode(event.currentTarget.value)}
              />
            </FormGroup>
          ) : null}
          <Checkbox
            checked={agree}
            onChange={(event) => setAgree(event.currentTarget.checked)}
          >
            I agree to the{' '}
            <a href={termsHref} target="_blank" rel="noreferrer">
              user agreement
            </a>
            .
          </Checkbox>
          <Button
            type="submit"
            intent="primary"
            fill={true}
            loading={busy}
            disabled={!agree || !email.trim() || (showCode && !code.trim())}
          >
            Create account
          </Button>
          {showCode && !code.trim() ? (
            <Button
              className={classes.requestInvite}
              minimal={true}
              fill={true}
              disabled={!agree || !email.trim() || busy}
              onClick={() => void run(true)}
            >
              I do not have a code - request an invitation
            </Button>
          ) : null}
        </form>
        <p className="muted small">
          After the account is created, sign in as usual. The next sign-in lands
          on your own console.
        </p>
        {error ? <p className="danger-text">{error}</p> : null}
      </Card>
    </main>
  );
}
