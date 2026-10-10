import {
  Alignment,
  Button,
  Classes,
  Navbar,
  NavbarGroup,
  Tooltip,
} from '@blueprintjs/core';
import React, { useState } from 'react';

import { type SettingsTab, SettingsDialog } from '../../dialog/SettingsDialog';
import { useSidebarCollapsed } from '../../common/SidebarContainer';
import { useSyncActivity } from '../../common/useSyncActivity';
import classes from './BottomNav.module.scss';
import clsx from 'clsx';

/**
 * The settings dialog's first section, which is what the plain Settings button
 * opens it on. Named because "first" is a fact about the dialog, not about this
 * button: a General section in front of Sync would be reached from here, and
 * not from the sync button.
 */
const FIRST_SETTINGS_TAB: SettingsTab = 'sync';

export const BottomNav = () => {
  // One settings dialog, opened by either button: the sync one (which also
  // reports the sync) lands on Sync explicitly, the settings one on the
  // dialog's first section. Which button opened it decides the section, so
  // there is no second dialog and no second thing to close.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] =
    useState<SettingsTab>(FIRST_SETTINGS_TAB);
  const openSettings = (tab: SettingsTab) => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };
  const collapsed = useSidebarCollapsed();
  // the syncs that matter usually run in the service worker, not in this page;
  // the notice arrives from there (see data/repo/syncActivity.ts)
  const syncing = useSyncActivity();

  // The sync button is the sync indicator as well as the way into the sync
  // section: its icon spins while a cycle runs, and its label says so.
  const syncLabel = syncing ? 'Syncing…' : 'Sync';
  const syncButton = (
    <Button
      icon="refresh"
      className={clsx(syncing && 'tv-syncing')}
      text={collapsed ? undefined : syncLabel}
      title={collapsed ? undefined : syncLabel}
      aria-label={syncLabel}
      onClick={() => openSettings('sync')}
    />
  );
  const settingsButton = (
    <Button
      icon="cog"
      text={collapsed ? undefined : 'Settings'}
      title={collapsed ? undefined : 'Settings'}
      aria-label="Settings"
      onClick={() => openSettings(FIRST_SETTINGS_TAB)}
    />
  );
  // in the rail the buttons are icons only, so the label moves into a Blueprint
  // tooltip instead of the browser's own title bubble
  const navButtons = collapsed ? (
    <>
      <Tooltip content={syncLabel} placement="right">
        {syncButton}
      </Tooltip>
      <Tooltip content="Settings" placement="right">
        {settingsButton}
      </Tooltip>
    </>
  ) : (
    <>
      {syncButton}
      {settingsButton}
    </>
  );

  return (
    <div className={clsx(classes.container, collapsed && classes.collapsed)}>
      {collapsed ? (
        <div className={clsx(Classes.DARK, classes.navbar, classes.rail)}>
          {navButtons}
        </div>
      ) : (
        <Navbar className={clsx(Classes.DARK, classes.navbar)}>
          <NavbarGroup align={Alignment.LEFT}>{navButtons}</NavbarGroup>
        </Navbar>
      )}
      <SettingsDialog
        isOpen={settingsOpen}
        initialTab={settingsTab}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
};
