import { Button, Card, FormGroup } from '@blueprintjs/core';
import React, { useState } from 'react';
import { useUnit } from 'effector-react';

import { createInvite } from '../data/actions';
import { $account, $invite } from '../data/stores/accounts';
import { CopyButton } from '../components/CopyButton';
import classes from '../layout.module.scss';

/**
 * Pair Code: the one-shot action of adding a device.
 *
 * The code is single use, shown once, and has to be carried to another machine
 * by hand - so it gets a copy button and a select-all fallback, and the server
 * URL comes with it, because an extension pointed at the wrong address is the
 * most common way pairing fails.
 */
export function PairCodePanel() {
  const { account, invite } = useUnit({ account: $account, invite: $invite });
  const [ttl, setTtl] = useState(900);
  const [busy, setBusy] = useState(false);
  if (!account?.user) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    await createInvite(account.user.id, ttl);
    setBusy(false);
  };

  return (
    <section>
      <div className={classes.panelHead}>
        <div>
          <h2>Pair a new device</h2>
          <p className="muted small">
            A code adds a device to this account. It works once and expires; the
            device exchanges it for its own token, which is the only way into
            the account's data. Paste the code into the extension's sync dialog
            on the device you are adding.
          </p>
        </div>
      </div>

      <Card>
        <form className="toolbar" onSubmit={submit}>
          <FormGroup
            label="valid for (seconds)"
            labelFor="invite-ttl"
            className="inline"
          >
            <input
              id="invite-ttl"
              type="number"
              min={60}
              max={86400}
              value={ttl}
              onChange={(event) =>
                setTtl(Number(event.currentTarget.value) || 900)
              }
            />
          </FormGroup>
          <Button type="submit" intent="primary" loading={busy}>
            New code
          </Button>
        </form>

        {invite ? (
          <div className={classes.codeBox}>
            <div className={classes.codeRow}>
              <CopyButton text={invite.code} />
            </div>
            <div className={classes.expiry}>
              single use · expires{' '}
              {new Date(invite.expires_at).toLocaleTimeString()} · paste it into
              the extension on the device you are pairing
            </div>
          </div>
        ) : null}

        {invite ? (
          <div className={classes.serverUrlBox}>
            <span className="muted small">server URL for the extension: </span>
            {/* `location.origin` is the address this browser used to reach the
                console, which is exactly what the extension should be pointed
                at. */}
            <CopyButton text={window.location.origin} />
          </div>
        ) : null}

        <p className="muted small" style={{ marginTop: 12 }}>
          The extension has to reach this server, and its own Content Security
          Policy decides which hosts it may talk to - a LAN address is allowed
          by default, and <code>TABVERSE_ALLOWED_SERVERS</code> narrows that at
          build time.
        </p>
      </Card>
    </section>
  );
}
