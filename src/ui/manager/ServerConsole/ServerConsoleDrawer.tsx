/**
 * The server console in an expandable right side panel (adr/0025).
 *
 * This is deliberately not a tool of `TabSpaceRightSideView`: the console is
 * not about the tabverse on screen, it is not one of the tools that share that
 * panel's tabs and pinning, and it wants more room than a tool column. It is
 * its own panel, anchored to the right edge of the manager page, collapsed to
 * a handle and expanded to a wide drawer. The expanded state is a window-local
 * setting (`useSettingItem`), like the sidebar's, not a record.
 *
 * What the drawer embeds is a normal web app the paired server serves at
 * `<baseUrl>/console/` (adr/0023), so "open the console in the panel" is an
 * iframe. Two facts about that are worth writing down:
 *
 * - **The framed side has to agree.** The console is served with
 *   `frame-ancestors` from `TABVERSED_FRAME_ANCESTORS` (adr/0025); the shipped
 *   default admits browser extensions and no web page, and an older server
 *   binary still refuses the frame with `frame-ancestors 'none'` - the
 *   extension's own `frame-src` is only half of the permission.
 * - **The session is the browser's.** The console signs in with a
 *   `tv_session` cookie (adr/0012, adr/0021) that is `SameSite=Lax`, and this
 *   page is a `chrome-extension://` document - a different site - so whether
 *   the cookie travels into the frame is Chrome's cookie rules, not ours.
 *   When it does not, the frame shows the console signed out, and "Open in a
 *   tab" is the path that always works: there the console is a top-level page
 *   on its own origin and the cookie is ordinary first-party.
 *
 * The panel reads the pairing fresh on every mount and subscribes to
 * `SyncMsg.ConfigChanged` for flips while it stays open (published by the sync
 * dialog on pair and disconnect). The iframe mounts only for the paired state,
 * so no request is ever made to a server the user has not configured.
 */
import { Button, Icon } from '@blueprintjs/core';
// biome-ignore lint/correctness/noUnusedImports: classic jsx transform needs React in scope (tsconfig "jsx": "react"), TS2686 otherwise
import React, { useCallback, useEffect, useState } from 'react';

import { logger } from '../../../global';
import { loadSyncConfig } from '../../../data/repo/syncConfig';
import {
  SyncMsg,
  subscribePubSubMessage,
  unsubscribePubSubMessage,
} from '../../../message/message';
import { useSettingItem } from '../../../storage/localSetting';
import classes from './ServerConsoleDrawer.module.scss';

/** Remembered across reloads: is the drawer open? */
const DRAWER_OPEN_SETTING = 'tabverse_server_console_open';

/**
 * The console's URL for a server address: one slash between the two parts,
 * trailing slashes on the address dropped so `http://host:8223/` and
 * `http://host:8223` are the same page, and the trailing slash the console's
 * own links use kept so its relative paths resolve under `/console/`.
 */
export function consoleUrlOf(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/console/`;
}

export type ServerConsoleState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'unpaired' }
  | { kind: 'ready'; url: string };

export interface ServerConsoleDrawerPanelProps {
  state: ServerConsoleState;
  onOpenInTab: (url: string) => void;
  onCollapse: () => void;
}

/**
 * The expanded drawer, presentational so its shapes can be checked by what
 * they render (ADR 0019, AGENTS.md: no browser).
 */
export function ServerConsoleDrawerPanel(props: ServerConsoleDrawerPanelProps) {
  const { state, onOpenInTab, onCollapse } = props;

  return (
    <aside className={classes.drawer} aria-label="Sync server console">
      <header className={classes.header}>
        <span className={classes.title}>
          <Icon icon="cloud-server" /> Server console
        </span>
        {state.kind === 'ready' ? (
          <span className={classes.url}>{state.url}</span>
        ) : null}
        <span className={classes.spacer} />
        {state.kind === 'ready' ? (
          <Button
            minimal={true}
            small={true}
            icon="share"
            text="Open in a tab"
            title="Open the console as its own tab, where your sign-in always carries"
            onClick={() => onOpenInTab(state.url)}
          />
        ) : null}
        <Button
          minimal={true}
          small={true}
          icon="chevron-right"
          aria-label="Collapse the server console"
          title="Collapse"
          onClick={onCollapse}
        />
      </header>
      <div className={classes.body}>
        {state.kind === 'loading' ? (
          <p className={classes.hint}>Reading the sync setup…</p>
        ) : null}
        {state.kind === 'error' ? (
          <p className={classes.hint}>
            Could not read the sync setup. Collapse and reopen this panel to
            retry.
          </p>
        ) : null}
        {state.kind === 'unpaired' ? (
          <p className={classes.hint}>
            Not paired with a server yet. Pair one from the sync button in the
            bottom bar, and this panel shows its console.
          </p>
        ) : null}
        {state.kind === 'ready' ? (
          <>
            <p className={classes.note}>
              If the console looks signed out in here, use “Open in a tab”: the
              session cookie is the browser's, and a frame is a different site.
            </p>
            <iframe
              className={classes.frame}
              src={state.url}
              title="Sync server console"
            />
          </>
        ) : null}
      </div>
    </aside>
  );
}

export function ServerConsoleDrawer() {
  const [expanded, setExpanded] = useSettingItem<boolean>(
    DRAWER_OPEN_SETTING,
    (value) => value === 'true',
    (value) => (value ? 'true' : 'false'),
  );
  const [state, setState] = useState<ServerConsoleState>({ kind: 'loading' });

  const reload = useCallback(() => {
    loadSyncConfig()
      .then((cfg) => {
        setState(
          cfg
            ? { kind: 'ready', url: consoleUrlOf(cfg.baseUrl) }
            : { kind: 'unpaired' },
        );
      })
      .catch((err) => {
        logger.log('server console panel: cannot read the sync config', err);
        setState({ kind: 'error' });
      });
  }, []);

  useEffect(() => {
    reload();
    const token = subscribePubSubMessage(SyncMsg.ConfigChanged, reload);
    return () => {
      unsubscribePubSubMessage(token);
    };
  }, [reload]);

  const openInTab = useCallback((url: string) => {
    void chrome.tabs.create({ url });
  }, []);

  if (expanded) {
    return (
      <ServerConsoleDrawerPanel
        state={state}
        onOpenInTab={openInTab}
        onCollapse={() => setExpanded(false)}
      />
    );
  }

  return (
    <div className={classes.rail}>
      <button
        type="button"
        className={classes.handle}
        aria-label="Open the sync server console"
        title="Server console"
        onClick={() => setExpanded(true)}
      >
        <Icon icon="cloud-server" />
      </button>
    </div>
  );
}
