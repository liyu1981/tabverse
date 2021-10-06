import * as React from 'react';

import {
  Alignment,
  Button,
  Classes,
  Navbar,
  NavbarGroup,
} from '@blueprintjs/core';

import { AboutDialog } from '../dialog/AboutDialog';
import { DropboxDialog } from '../dialog/DropboxDialog';
import { SettingDialog } from '../dialog/SettingDialog';
import { TABSPACE_VERSION } from '../../global';
import { useState } from 'react';

function createStyles(): { [k: string]: React.CSSProperties } {
  return {
    container: {
      position: 'fixed',
      bottom: '0px',
      left: '-1px',
      width: '320px',
    },
    version: {
      color: '#999',
      textShadow: '0 1px 0 black',
    },
  };
}

export const BottomNav = (props) => {
  const styles = createStyles();

  const [settingOpened, setSettingOpened] = useState(false);
  const [aboutOpened, setAboutOpened] = useState(false);
  const [driveOpened, setDriveOpened] = useState(false);

  return (
    <div style={styles.container}>
      <Navbar className={Classes.DARK}>
        <NavbarGroup align={Alignment.LEFT}>
          <a style={styles.version} onClick={() => setAboutOpened(true)}>
            {TABSPACE_VERSION}
          </a>
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
