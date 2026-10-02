import { Button, Card, HTMLTable, Switch } from '@blueprintjs/core';
import React, { useState } from 'react';
import { useUnit } from 'effector-react';

import {
  archiveDevice,
  archiveDeviceRecords,
  archiveToken,
  revokeDevice,
  revokeToken,
} from '../data/actions';
import { ago, agoIso } from '../data/format';
import {
  $account,
  $credentialsArchived,
  setCredentialsArchived,
  visibleCredentials,
} from '../data/stores/accounts';
import type { DeviceInfo, TokenInfo } from '../data/types';
import { ConfirmDialog } from '../components/Dialogs';
import classes from '../layout.module.scss';

type Pending =
  | {
      kind: 'device';
      device: DeviceInfo;
      what: 'revoke' | 'archive' | 'records';
    }
  | { kind: 'token'; token: TokenInfo; what: 'revoke' | 'archive' }
  | null;

/**
 * Devices and tokens: everything that can reach the account.
 *
 * Archived rows are hidden unless asked for, in *both* tables - archiving that
 * leaves the row on screen is the same bug in both directions: a control that
 * reports success and changes nothing, and rows that are retired but still
 * cluttering the list (adr/0011).
 */
export function CredentialsPanel() {
  const { account, showArchived } = useUnit({
    account: $account,
    showArchived: $credentialsArchived,
  });
  const [pending, setPending] = useState<Pending>(null);
  if (!account?.user) return null;

  const { user, stats, devices } = account;
  const visible = visibleCredentials(account, showArchived);
  const liveTokens = visible.tokens.filter((tok) => !tok.revoked).length;
  const archivedDevices = devices.filter((dev) => dev.archived).length;

  const run = async () => {
    const job = pending;
    setPending(null);
    if (!job) return;
    if (job.kind === 'device') {
      if (job.what === 'revoke') {
        await revokeDevice(user.id, job.device.id);
        return;
      }
      if (job.what === 'archive') {
        await archiveDevice(user.id, job.device.id, !job.device.archived);
        return;
      }
      await archiveDeviceRecords(user.id, job.device.id, !job.device.archived);
      return;
    }
    if (job.what === 'revoke') {
      await revokeToken(user.id, job.token.hash);
      return;
    }
    await archiveToken(user.id, job.token.hash, !job.token.archived);
  };

  const ask = (next: NonNullable<Pending>) => setPending(next);

  return (
    <section>
      <div className={classes.panelHead}>
        <div>
          <h2>Devices &amp; Tokens</h2>
          <p className="muted small">
            Revoking cuts a device off. Archiving retires it from these tables,
            and it never deletes anything: the row stays stored and keeps
            syncing to the user's own devices.
          </p>
        </div>
        {/* One control for both tables, because archived is the same question of
            each: hidden while it is off, labelled when it is on. */}
        <Switch
          checked={showArchived}
          label="show archived"
          onChange={(event) =>
            setCredentialsArchived(event.currentTarget.checked)
          }
        />
      </div>

      <div className="stat-row">
        <Stat value={visible.devices.length} label="devices" />
        <Stat value={liveTokens} label="live tokens" />
        {visible.tokens.length > liveTokens ? (
          <Stat value={visible.tokens.length - liveTokens} label="revoked" />
        ) : null}
        {archivedDevices ? (
          <Stat
            value={showArchived ? archivedDevices : visible.hiddenDevices}
            label="archived"
          />
        ) : null}
        {stats.live ? (
          <Stat value={stats.live} label="records written" />
        ) : null}
      </div>

      <Card>
        <h3>Devices</h3>
        <HTMLTable className={classes.tableCard} striped={false}>
          <thead>
            <tr>
              <th>Device</th>
              <th>Paired</th>
              <th>Last seen</th>
              <th>Tokens</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!visible.devices.length ? (
              <tr className="empty-row">
                <td colSpan={5}>
                  {visible.hiddenDevices
                    ? 'no devices here - the archived ones are hidden'
                    : 'no devices paired'}
                </td>
              </tr>
            ) : null}
            {visible.devices.map((dev) => (
              <tr
                key={dev.id}
                className={dev.archived ? 'archived-row' : undefined}
              >
                <td>
                  <div>
                    {dev.name}
                    {dev.archived ? (
                      <span
                        className="badge archived"
                        title="hidden from the default views; still stored and still synced"
                      >
                        archived
                      </span>
                    ) : null}
                    {dev.archived_records ? (
                      <span className="badge archived">
                        {dev.archived_records} archived
                      </span>
                    ) : null}
                  </div>
                  <div className="mono muted">{dev.id}</div>
                </td>
                <td className="muted">{agoIso(dev.created_at)}</td>
                <td className="muted">{ago(dev.last_used)}</td>
                <td>
                  <span
                    className={`badge ${dev.active_tokens ? 'live' : 'revoked'}`}
                  >
                    {dev.active_tokens} live
                  </span>
                </td>
                <td>
                  <div className="actions">
                    <DeviceActions
                      device={dev}
                      hasRecords={stats.live > 0}
                      onAsk={(what) =>
                        ask({ kind: 'device', device: dev, what })
                      }
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </HTMLTable>
      </Card>

      <Card>
        <h3>Device tokens</h3>
        <p className="muted small">
          Every device holds a token. The server only stores its hash, so a
          token cannot be shown again - revoking one is final, and the device
          has to pair again.
        </p>
        <HTMLTable className={classes.tableCard} striped={false}>
          <thead>
            <tr>
              <th>Token</th>
              <th>Device</th>
              <th>Issued</th>
              <th>Last used</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!visible.tokens.length ? (
              <tr className="empty-row">
                <td colSpan={5}>
                  {visible.hiddenTokens
                    ? 'no tokens here - the archived ones are hidden'
                    : 'no tokens'}
                </td>
              </tr>
            ) : null}
            {visible.tokens.map((tok) => (
              <tr key={tok.hash}>
                <td className="mono">
                  {tok.fingerprint}
                  {tok.archived ? (
                    <span
                      className="badge archived"
                      title="hidden from the default lists; still revoked"
                    >
                      archived
                    </span>
                  ) : null}
                </td>
                <td>
                  {tok.device_name || (
                    <span className="muted">(unknown device)</span>
                  )}
                </td>
                <td className="muted">{agoIso(tok.created_at)}</td>
                <td className="muted">{ago(tok.last_used)}</td>
                <td>
                  <div className="actions">
                    {tok.revoked ? (
                      <>
                        <Button
                          small={true}
                          minimal={true}
                          title="Hide this token from the default lists. It stays revoked (adr/0011)."
                          onClick={() =>
                            ask({ kind: 'token', token: tok, what: 'archive' })
                          }
                        >
                          {tok.archived ? 'Unarchive' : 'Archive'}
                        </Button>
                        {!tok.archived ? (
                          <span className="muted small">revoked</span>
                        ) : null}
                      </>
                    ) : (
                      <Button
                        small={true}
                        minimal={true}
                        intent="danger"
                        onClick={() =>
                          ask({ kind: 'token', token: tok, what: 'revoke' })
                        }
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </HTMLTable>
      </Card>

      <ConfirmDialog
        isOpen={!!pending}
        title={
          pending?.kind === 'token'
            ? pending.what === 'revoke'
              ? 'Revoke this token'
              : pending.token.archived
                ? 'Bring this token back'
                : 'Archive this token'
            : pending?.what === 'revoke'
              ? 'Revoke this device'
              : pending?.what === 'records'
                ? 'Archive what this device wrote'
                : pending?.device.archived
                  ? 'Bring this device back'
                  : 'Archive this device'
        }
        body={pending ? explain(pending) : ''}
        intent={pending?.what === 'revoke' ? 'danger' : 'primary'}
        confirmLabel={
          pending?.what === 'revoke'
            ? 'Revoke'
            : pending?.kind === 'device' && pending.device.archived
              ? 'Restore'
              : 'Archive'
        }
        onCancel={() => setPending(null)}
        onConfirm={run}
      />
    </section>
  );
}

function Stat(props: { value: number; label: string }) {
  return (
    <div className="stat">
      <div className="v">{props.value}</div>
      <div className="k">{props.label}</div>
    </div>
  );
}

/**
 * The device row's buttons, in the order the workflow goes: cut access, then
 * retire it, then (optionally) retire what it last wrote. Archive is only
 * offered once there is nothing left to revoke - the server enforces it too,
 * with a 409 the console shows as a sentence rather than a failure.
 */
function DeviceActions(props: {
  device: DeviceInfo;
  hasRecords: boolean;
  onAsk: (what: 'revoke' | 'archive' | 'records') => void;
}) {
  const dev = props.device;
  if (dev.active_tokens) {
    return (
      <Button
        small={true}
        minimal={true}
        intent="danger"
        onClick={() => props.onAsk('revoke')}
      >
        Revoke
      </Button>
    );
  }
  return (
    <>
      <Button
        small={true}
        minimal={true}
        title={
          dev.archived
            ? 'Bring this device back into the default views. It stays revoked.'
            : 'Hide this device from the default views. Its records stay stored and keep syncing to your devices, and this is reversible (adr/0011).'
        }
        onClick={() => props.onAsk('archive')}
      >
        {dev.archived ? 'Unarchive' : 'Archive'}
      </Button>
      {dev.archived_records ? (
        <Button
          small={true}
          minimal={true}
          onClick={() => props.onAsk('records')}
        >
          Restore records
        </Button>
      ) : props.hasRecords ? (
        <Button
          small={true}
          minimal={true}
          title="Hide the records this device last wrote from the default views. They stay stored and keep syncing (adr/0011)."
          onClick={() => props.onAsk('records')}
        >
          Archive its records
        </Button>
      ) : null}
      {!dev.archived ? <span className="muted small">revoked</span> : null}
    </>
  );
}

/** The sentence the operator reads before answering, one per question. */
function explain(pending: NonNullable<Pending>): string {
  if (pending.kind === 'token') {
    const tok = pending.token;
    if (pending.what === 'revoke') {
      return (
        `Revoke token ${tok.fingerprint} on ${tok.device_name || 'device'}?\n\n` +
        'The device will stop syncing and has to pair again.'
      );
    }
    return tok.archived
      ? `Bring token ${tok.fingerprint} back into the lists. It stays revoked.`
      : `Archiving token ${tok.fingerprint}. It stays revoked; it is only hidden from the default lists.`;
  }
  const dev = pending.device;
  if (pending.what === 'revoke') {
    return (
      `Revoke every token of "${dev.name}"?\n\n` +
      'The device will stop syncing and has to pair again.'
    );
  }
  if (pending.what === 'records') {
    return dev.archived_records
      ? `Restoring the records "${dev.name}" last wrote. Deleted records stay deleted.`
      : `Archiving the records "${dev.name}" last wrote. They stay stored and keep ` +
          "syncing to your devices; they only leave this console's default views. " +
          'A record edited later comes back on its own.';
  }
  return dev.archived
    ? `Bringing "${dev.name}" back into the default views. It stays revoked.`
    : `Archiving hides "${dev.name}" from the default views. Nothing is deleted: ` +
        'its records stay stored and keep syncing to your devices.';
}
