import * as React from 'react';

import { Menu, MenuItem } from '@blueprintjs/core';

import { ISidebarComponentProps } from '../Sidebar/Sidebar';

export function createStyles(): { [k: string]: React.CSSProperties } {
  return {
    singleMenuContainer: {
      marginBottom: '18px',
    },
  };
}

export type CreateNewTabverseMenuProps = ISidebarComponentProps;

export const CreateNewTabverseMenu = (props: CreateNewTabverseMenuProps) => {
  const styles = createStyles();
  return (
    <div style={styles.singleMenuContainer}>
      <Menu>
        <MenuItem
          icon="insert"
          text={<b>Create New Tabverse</b>}
          onClick={() => {
            chrome.windows.create((window) => {
              chrome.tabs.create({
                windowId: window.id,
                active: true,
                url: 'manager.html?op=new',
              });
            });
          }}
        ></MenuItem>
      </Menu>
    </div>
  );
};