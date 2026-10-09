import { AnchorButton, Button, Tag } from '@blueprintjs/core';
import React from 'react';
import { useUnit } from 'effector-react';

import { refreshCurrentView, signOut } from '../data/actions';
import { $bootStatus, $config, $me, $totals } from '../data/stores/session';
import classes from '../layout.module.scss';

/**
 * The brand bar. It is the one piece of the extension's chrome that reads as a
 * frame around everything else - the bottom nav there is the same colour - so
 * the console reads as the extension's window with its content swapped.
 */
export function TopBar() {
  const { config, me, totals, status } = useUnit({
    config: $config,
    me: $me,
    totals: $totals,
    status: $bootStatus,
  });

  return (
    <header className={classes.topbar}>
      <div className={classes.brand}>
        <span aria-hidden={true}>◆</span>
        <span>tabversed</span>
        {config?.version ? (
          <span className={classes.version}>v{config.version}</span>
        ) : null}
      </div>
      <div className={classes.topbarRight}>
        {status === 'signed-in' && totals ? (
          <span className={classes.totals}>
            {totals.users} accounts · {totals.devices} devices ·{' '}
            {totals.active_tokens} tokens · {totals.live_records} records
          </span>
        ) : null}
        {/* A real link, not a route: "/" is this project's own index - a
            different page of this origin that the console's own state has
            nothing to do with. Shown only when the server says it has one
            (`me.docs`), and named for what it is rather than for what the
            index happens to hold. */}
        {me?.docs ? (
          <AnchorButton
            minimal={true}
            small={true}
            href="/"
            title="tabverse, at this server's index"
          >
            tabverse
          </AnchorButton>
        ) : null}
        <Button
          minimal={true}
          small={true}
          icon="refresh"
          title="Reload what is on screen"
          onClick={() => void refreshCurrentView()}
        >
          Refresh
        </Button>
        {me?.signed_in ? (
          <Button
            minimal={true}
            small={true}
            icon="log-out"
            onClick={() => void signOut()}
          >
            Sign out{me.name ? ` (${me.name})` : ''}
          </Button>
        ) : null}
        {me?.role === 'admin' ? <Tag minimal={true}>operator</Tag> : null}
      </div>
    </header>
  );
}

/** The one case where being signed in is not enough: this account is the
 *  address the operator is expected to be and nobody has claimed the role. The
 *  server says so, so the page does not have to work it out. */
export function OperatorHint() {
  const me = useUnit($me);
  if (!me?.awaiting_operator) return null;
  return (
    <div className={classes.operatorHint}>
      <strong>
        You are the operator address, but nobody has claimed the role yet.
      </strong>
      <span>
        Restart the server and the first account registered with this address
        becomes the operator. Until then you can still use everything that is
        yours - your devices, your tabverses, your pairing codes.
      </span>
    </div>
  );
}
