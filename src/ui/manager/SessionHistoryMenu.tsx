import * as React from 'react';

import { Drawer, Menu, MenuItem } from '@blueprintjs/core';

import { SessionBrowser } from '../sessionHistory/SessionBrowser';
import { createStyles as createStylesFromNewTabverseMenu } from './CreateNewTabverseMenu';
import { useState } from 'react';

export const SessionHistoryMenu = () => {
  const styles = createStylesFromNewTabverseMenu();

  const [isOpen, setIsOpen] = useState(false);

  return (
    <div style={styles.singleMenuContainer}>
      <Menu>
        <MenuItem
          icon="history"
          text={<b>Browser Session History</b>}
          onClick={() => setIsOpen(true)}
        />
        <Drawer
          icon="history"
          title="Browser Session History"
          isOpen={isOpen}
          position="right"
          onClose={() => setIsOpen(false)}
        >
          {isOpen ? <SessionBrowser /> : ''}
        </Drawer>
      </Menu>
    </div>
  );
};
