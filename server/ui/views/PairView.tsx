import {
  Button,
  Callout,
  Card,
  FormGroup,
  InputGroup,
  Intent,
} from '@blueprintjs/core';
import React, { useEffect, useState } from 'react';
import { useUnit } from 'effector-react';

import classes from '../layout.module.scss';
import { $me } from '../data/stores/session';
import {
  PairOutcome,
  PairRequest,
  runPairFlow,
  sendCredentialsToExtension,
  stashPairRequest,
} from '../data/pair';
import { SignInView } from './SignInView';

/**
 * Pairing a browser extension to this account (adr/0020).
 *
 * The page was opened by the extension, not by a person: the URL query
 * carries the extension's id and a nonce, and this view is the "agree" step in
 * between. It is the one place in the console where a credential is created by
 * the page rather than minted as a code the extension redeems - the token goes
 * straight from the server into a message addressed to that one extension, and
 * is never painted here.
 *
 * It is a card like the sign-in form, because it is the same moment: one person,
 * one decision, one account. Three phases, because that is all the truth has -
 * waiting to agree, handing the token over, and what happened. There is no
 * "connected" phase: once the extension has the token this window has nothing
 * left to do.
 */

export interface PairViewProps {
  /** Read from the URL query; null when the page was not opened by one. */
  request: PairRequest | null;
  /** Injectable so a test does not need `chrome.runtime`. */
  sendToExtension?: typeof sendCredentialsToExtension;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; outcome: PairOutcome };

/** A name to propose: the page cannot read the browser, the person can. */
function suggestedDeviceName(): string {
  if (typeof navigator === 'undefined') return 'chrome';
  const agent = navigator.userAgent || '';
  const os = /Windows/.test(agent)
    ? 'Windows'
    : /Macintosh/.test(agent)
      ? 'macOS'
      : /Linux/.test(agent)
        ? 'Linux'
        : '';
  return os ? `Chrome on ${os}` : 'chrome';
}

export function PairView(props: PairViewProps) {
  const me = useUnit($me);
  const [deviceName, setDeviceName] = useState(suggestedDeviceName);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  // A pending request is stashed before a sign-in round trip, because both
  // return paths come back to the console at /console (withConsoleReturn sets
  // the return target server side) and the query carrying ext+nonce would be
  // lost with it.
  useEffect(() => {
    if (props.request && me && !me.signed_in) {
      stashPairRequest(props.request);
    }
  }, [props.request, me]);

  // Signing in comes first when it is needed: a token can only be minted for a
  // signed-in account, and the view picks the stashed request up on the way back.
  if (props.request && me && !me.signed_in) {
    return (
      <>
        <Card className={classes.signinCard}>
          <Callout intent={Intent.PRIMARY} title="Sign in to connect Tabverse">
            <p className="muted small">
              This page was opened by the Tabverse extension on this computer.
              Sign in to this account and you will come straight back here to
              approve the browser.
            </p>
          </Callout>
        </Card>
        <SignInView />
      </>
    );
  }

  const accept = async () => {
    const request = props.request;
    if (!request) return;
    setPhase({ kind: 'working' });
    const send = props.sendToExtension ?? sendCredentialsToExtension;
    const messaging = { runtime: (globalThis as any).chrome?.runtime };
    const outcome = await runPairFlow(
      request,
      deviceName.trim(),
      (req, creds) => send(messaging, req, creds),
    );
    setPhase({ kind: 'done', outcome });
  };

  // "This page was not opened by Tabverse" is derived from the props, not from
  // an effect: a consent form with no extension behind it is the one state this
  // page must never show, and it must be right on the first paint (and in a
  // static render, which is how these views are tested).
  const outcome =
    phase.kind === 'done'
      ? phase.outcome
      : props.request
        ? null
        : ({ kind: 'no-extension' } as PairOutcome);

  return (
    <main className={classes.signin}>
      <Card className={classes.signinCard}>
        <h1>Connect Tabverse</h1>
        {outcome === null ? (
          <>
            <p className="muted">
              A Tabverse extension on this computer is asking to sync with this
              account. It will send the tabverses you save, and receive the ones
              saved elsewhere.
            </p>
            <FormGroup label="Device name" labelFor="pair-device-input">
              <InputGroup
                id="pair-device-input"
                value={deviceName}
                onChange={(event) => setDeviceName(event.currentTarget.value)}
                fill={true}
              />
            </FormGroup>
            <p className="muted small">
              This is how the browser appears in the account's device list. A
              token is created for it and handed straight to the extension - it
              is never shown on this page.
            </p>
            <Button
              text="Allow this device"
              loading={phase.kind === 'working'}
              onClick={() => void accept()}
            />
          </>
        ) : (
          <Outcome outcome={outcome} />
        )}
      </Card>
    </main>
  );
}

function Outcome(props: { outcome: PairOutcome }) {
  const { outcome } = props;
  if (outcome.kind === 'sent') {
    return (
      <Callout intent={Intent.SUCCESS} title="Tabverse is connected">
        <p>
          The extension has its token and syncing has started. You can close
          this window.
        </p>
      </Callout>
    );
  }
  if (outcome.kind === 'refused') {
    return (
      <Callout intent={Intent.DANGER} title="Could not pair this browser">
        <p>{outcome.message}</p>
        <p className="muted small">Sign in to this account and try again.</p>
      </Callout>
    );
  }
  if (outcome.kind === 'unreachable') {
    return (
      <Callout
        intent={Intent.WARNING}
        title="Token created, extension not found"
      >
        <p>
          A device token was created for this account, but the extension did not
          answer ({outcome.reason}). If it was just updated or is disabled,
          close this window and start again from the extension.
        </p>
        <p className="muted small">
          The device can be revoked from the account's device list.
        </p>
      </Callout>
    );
  }
  return (
    <Callout
      intent={Intent.WARNING}
      title="This page was not opened by Tabverse"
    >
      <p>
        It is the pairing page for the Tabverse extension, and it only works
        from a link the extension opened.
      </p>
    </Callout>
  );
}
