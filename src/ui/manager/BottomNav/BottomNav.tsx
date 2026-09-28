import {
  Alignment,
  Button,
  Classes,
  Navbar,
  NavbarGroup,
} from '@blueprintjs/core';
import React, { useState } from 'react';

import { AboutDialog } from '../../dialog/AboutDialog';
import { ServerSyncDialog } from '../../dialog/ServerSyncDialog';
import { SettingDialog } from '../../dialog/SettingDialog';
import { useSidebarCollapsed } from '../../common/SidebarContainer';
import { TABSPACE_VERSION } from '../../../global';
import classes from './BottomNav.module.scss';
import clsx from 'clsx';

export const BottomNav = (props) => {
  const [settingOpened, setSettingOpened] = useState(false);
  const [aboutOpened, setAboutOpened] = useState(false);
  const [syncOpened, setSyncOpened] = useState(false);
  const collapsed = useSidebarCollapsed();

  // Blueprint's Navbar has no vertical mode, so the collapsed rail renders the
  // same two controls (same dark bar, same rounded buttons) as a plain column.
  const navButtons = (
    <>
      <Button
        minimal={true}
        icon="help"
        title={`Tabverse ${TABSPACE_VERSION}`}
        onClick={() => setAboutOpened(true)}
      />
      <Button
        icon="refresh"
        title="Server sync"
        onClick={() => setSyncOpened(true)}
      />
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
          <NavbarGroup align={Alignment.LEFT}>
            <Button minimal={true} onClick={() => setAboutOpened(true)}>
              {TABSPACE_VERSION}
            </Button>
          </NavbarGroup>
          <NavbarGroup align={Alignment.RIGHT}>
            {/* <Button icon="cog" onClick={() => setSettingOpened(true)} /> */}
            {navButtons}
          </NavbarGroup>
        </Navbar>
      )}
      <SettingDialog
        isOpen={settingOpened}
        onClose={() => setSettingOpened(false)}
      />
      <AboutDialog isOpen={aboutOpened} onClose={() => setAboutOpened(false)} />
      <ServerSyncDialog
        isOpen={syncOpened}
        onClose={() => setSyncOpened(false)}
      />
    </div>
  );
};
