import {
  Alignment,
  Button,
  Classes,
  Navbar,
  NavbarGroup,
} from '@blueprintjs/core';
import React, { useState } from 'react';

import { AboutDialog } from '../../dialog/AboutDialog';
import { DropboxDialog } from '../../dialog/DropboxDialog';
import { SettingDialog } from '../../dialog/SettingDialog';
import { TABSPACE_VERSION } from '../../../global';
import classes from './BottomNav.module.scss';
import clsx from 'clsx';

export const BottomNav = (props) => {
  const [settingOpened, setSettingOpened] = useState(false);
  const [aboutOpened, setAboutOpened] = useState(false);
  const [driveOpened, setDriveOpened] = useState(false);

  return (
    <div className={classes.container}>
      <Navbar className={clsx(Classes.DARK, classes.navbar)}>
        <NavbarGroup align={Alignment.LEFT}>
          <Button minimal={true} onClick={() => setAboutOpened(true)}>
            {TABSPACE_VERSION}
          </Button>
        </NavbarGroup>
        <NavbarGroup align={Alignment.RIGHT}>
          {/* <Button icon="cog" onClick={() => setSettingOpened(true)} /> */}
          <Button
            icon={<i className="fab fa-dropbox"></i>}
            onClick={() => setDriveOpened(true)}
          />
        </NavbarGroup>
      </Navbar>
      <SettingDialog
        isOpen={settingOpened}
        onClose={() => setSettingOpened(false)}
      />
      <AboutDialog isOpen={aboutOpened} onClose={() => setAboutOpened(false)} />
      <DropboxDialog
        isOpen={driveOpened}
        onClose={() => setDriveOpened(false)}
      />
    </div>
  );
};
