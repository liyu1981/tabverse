import { Button, Card, FormGroup, Spinner } from '@blueprintjs/core';
import React, { useState } from 'react';
import { useUnit } from 'effector-react';

import { requestSigninLink } from '../data/actions';
import { $me } from '../data/stores/session';
import { ProviderMark, providerLabel } from '../components/ProviderMark';
import classes from '../layout.module.scss';

/**
 * The sign-in form.
 *
 * There is nothing to sign in *to*: the session is a cookie the browser already
 * has, and the only question is whether the server still recognises it. Two
 * ways to answer it, and the order is the argument: the provider buttons come
 * first because a person with a Google or GitHub account should be one click
 * from signed in, and the address form is the fallback that works without either.
 *
 * The providers are links into the library's own login routes, without a return
 * address of our own: the server puts the console on every provider login, so
 * the target is chosen in one place and a stale console cannot leave somebody
 * landing on a page of JSON.
 */

/**
 * The order the buttons are offered in, which is a presentational decision and
 * not the order the server lists them in. Anything not named here keeps its
 * place at the end: a provider this file has never heard of is still a way in,
 * and a button with no mark is better than no button.
 */
const PROVIDER_ORDER = ['google', 'github'];

function orderedProviders(providers: string[]): string[] {
  const known = PROVIDER_ORDER.filter((name) => providers.includes(name));
  return [
    ...known,
    ...providers.filter((name) => !PROVIDER_ORDER.includes(name)),
  ];
}

export function SignInView() {
  const me = useUnit($me);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const providers = orderedProviders(me?.providers ?? []);
  // Whether the server can actually post mail. Without it the console used to
  // tell everybody that no mail server was configured, which is a lie on every
  // deployment that has one - and the person who most needs to know is the one
  // who has just asked for a link and is waiting.
  const canEmail = me?.smtp === true;

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
          Your Tabverse account, on this server and nowhere else.
        </p>

        {providers.length ? (
          <>
            <div className={classes.socialList}>
              {providers.map((name) => (
                <a
                  key={name}
                  className={classes.socialButton}
                  href={`/auth/${name}/login`}
                >
                  <span className={classes.socialMark}>
                    <ProviderMark name={name} />
                  </span>
                  <span>Continue with {providerLabel(name)}</span>
                </a>
              ))}
            </div>
            <div className={classes.orRule}>
              <span>or</span>
            </div>
          </>
        ) : null}

        <form onSubmit={submit}>
          <p className="muted small">
            Enter your address and we will send you a link that works once.
            There is no password to choose, forget or leak.
          </p>
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
          <Button type="submit" intent="primary" fill={true} loading={busy}>
            Send sign-in link
          </Button>
        </form>

        {sent ? (
          <p className="muted small">
            {canEmail
              ? 'Check your email for the link - the spam folder too. It works once and expires in 30 minutes.'
              : 'This server has no mail server, so the link was printed in its own log. It works once and expires in 30 minutes.'}
          </p>
        ) : null}
        {error ? <p className="danger-text">{error}</p> : null}
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
