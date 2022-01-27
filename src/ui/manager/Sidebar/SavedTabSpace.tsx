import * as React from 'react';

import { HTMLSelect } from '@blueprintjs/core';
import { ISidebarComponentProps } from './Sidebar';
import { SavedTabSpaceStore } from '../../../data/tabSpace/SavedTabSpaceStore';
import { TabSpace } from '../../../data/tabSpace/TabSpace';
import { TabSpaceRegistry } from '../../../data/tabSpace/TabSpaceRegistry';
import { isIdNotSaved } from '../../../data/common';
import { observer } from 'mobx-react-lite';

function createStyles(): { [k: string]: React.CSSProperties } {
  return {
    container: {
      padding: '18px',
      fontSize: '1.2em',
      textAlign: 'right',
    },
    line: {
      marginBottom: '8px',
    },
  };
}

export type ISavedTabSpaceProps = ISidebarComponentProps & {
  tabSpace: TabSpace;
  tabSpaceRegistry: TabSpaceRegistry;
  savedTabSpaceStore: SavedTabSpaceStore;
};

export const SavedTabSpace = observer(
  ({ tabSpaceRegistry, savedTabSpaceStore }: ISavedTabSpaceProps) => {
    const styles = createStyles();

    const openedSavedCount = tabSpaceRegistry.registry.reduce(
      (count, tabSpaceStub) => {
        return count + (isIdNotSaved(tabSpaceStub.id) ? 0 : 1);
      },
      0,
    );

    return (
      <div style={styles.container}>
        <div style={styles.line}>
          <b>{`${savedTabSpaceStore.totalSavedCount}`}</b> tabverses saved
        </div>
        {openedSavedCount > 0 ? (
          <div style={styles.line}>
            <b>{`${openedSavedCount}`}</b> of them loaded
          </div>
        ) : (
          ''
        )}
        <div style={styles.line}>
          sort by{' '}
          <HTMLSelect minimal={true}>
            <option>Created Time</option>
            <option>Saved Time</option>
          </HTMLSelect>
        </div>
      </div>
    );
  },
);
