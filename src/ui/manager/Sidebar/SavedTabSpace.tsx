import * as React from 'react';

import { HTMLSelect } from '@blueprintjs/core';
import { ISidebarComponentProps } from './Sidebar';
import { SavedTabSpaceStore } from '../../../data/tabSpace/SavedTabSpaceStore';
import { TabSpace } from '../../../data/tabSpace/TabSpace';
import { TabSpaceRegistry } from '../../../data/tabSpace/TabSpaceRegistry';
import { isIdNotSaved } from '../../../data/common';
import { observer } from 'mobx-react-lite';
import classes from './SavedTabSpace.module.scss';

export type ISavedTabSpaceProps = ISidebarComponentProps & {
  tabSpace: TabSpace;
  tabSpaceRegistry: TabSpaceRegistry;
  savedTabSpaceStore: SavedTabSpaceStore;
};

export const SavedTabSpace = observer(
  ({ tabSpaceRegistry, savedTabSpaceStore }: ISavedTabSpaceProps) => {
    const openedSavedCount = tabSpaceRegistry.registry.reduce(
      (count, tabSpaceStub) => {
        return count + (isIdNotSaved(tabSpaceStub.id) ? 0 : 1);
      },
      0,
    );

    return (
      <div className={classes.noticeContainer}>
        <div className={classes.noticeLine}>
          <b>{`${savedTabSpaceStore.totalSavedCount}`}</b> tabverses saved
        </div>
        {openedSavedCount > 0 ? (
          <div className={classes.noticeLine}>
            <b>{`${openedSavedCount}`}</b> of them loaded
          </div>
        ) : (
          ''
        )}
        <div className={classes.noticeLine}>
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
