import { Button, Card, FormGroup, Spinner } from '@blueprintjs/core';
import React, { useState } from 'react';
import { useUnit } from 'effector-react';

import { requestSigninLink } from '../data/actions';
import { $me } from '../data/stores/session';
import classes from '../layout.module.scss';

/**
 * The sign-in form.
 *
 * There is nothing to sign in *to*: the session is a cookie the browser already
 * has, and the only question is whether the server still recognises it. What
 * this form does is ask for an address and have the server send a single-use
 * link (adr/0012), so there is no password to lose, reset or leak.
 *
 * The providers are links into the library's own login routes, without a return
 * address of our own: the server puts the console on every provider login, so
 * the target is chosen in one place and a stale console cannot leave somebody
 * landing on a page of JSON.
 */
export function SignInView() {
  const me = useUnit($me);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const providers = me?.providers ?? [];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError('');
    // Lowercased before it is sent, so the address the server hashes for the
    // session's identity and the one it stores are the same string however the
    // person typed it.
    const ok = await requestSigninLink(email);
    setBusy(false);
    if (ok) {
      setSent(true);
      setEmail('');
      return;
    }
    setError('The link could not be sent. Check the address and try again.');
  };

  return (
    <main className={classes.signin}>
      <Card className={classes.signinCard}>
        <h1>Sign in</h1>
        <p className="muted">
          Enter your email address and we will send you a single-use link. There
          is no password: the link signs you in, and only the server can read
          your data.
        </p>
        <form onSubmit={submit}>
          <FormGroup label="Email" labelFor="signin-email">
            <input
              id="signin-email"
              type="email"
              required={true}
              autoComplete="email"
              spellCheck={false}
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
          </FormGroup>
          <Button type="submit" intent="primary" loading={busy}>
            Send sign-in link
          </Button>
        </form>
        {sent ? (
          <p className="muted small">
            Check your email for the sign-in link. It works once and expires in
            30 minutes.
          </p>
        ) : null}
        {error ? <p className="danger-text">{error}</p> : null}
        {providers.length ? (
          <div className={classes.providers}>
            <span className="muted small">or continue with</span>
            {providers.map((name) => (
              <a
                key={name}
                className={classes.provider}
                href={`/auth/${name}/login`}
              >
                {name === 'github'
                  ? 'GitHub'
                  : name === 'google'
                    ? 'Google'
                    : name}
              </a>
            ))}
          </div>
        ) : null}
        <p className="muted small">
          No mail server is configured, so the server prints the link in its own
          log.
        </p>
      </Card>
    </main>
  );
}

/** The page's own loading state: one spinner, and the console's own frame. */
export function LoadingView() {
  return (
    <main className={classes.content}>
      <Spinner size={24} />
    </main>
  );
}
