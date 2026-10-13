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
 * account is identified by - and the agreement is the second thing the old
 * one-step flow never asked for. On success the server signs the pending
 * session out and this page gives way to the sign-in form.
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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !agree) return;
    setBusy(true);
    setError('');
    const done = await registerAccount(email, agree, code);
    setBusy(false);
    if (!done.ok) {
      setError(
        'The account could not be created. If this server is invite-only, check the invitation code.',
      );
    }
    // On success the server signed the session out and `sessionExpired` has
    // already switched the console back to the sign-in form.
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
          <FormGroup
            label="Invitation code (only if you were given one)"
            labelFor="register-code"
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
            disabled={!agree || !email.trim()}
          >
            Create account
          </Button>
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
