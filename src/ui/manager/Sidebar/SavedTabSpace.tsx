import React, { useEffect, useState } from 'react';
import {
  SavedTabSpaceCollection,
  SortMethods,
} from '../../../data/tabSpace/SavedTabSpaceCollection';

import { HTMLSelect } from '@blueprintjs/core';
import { ISidebarComponentProps } from './Sidebar';
import { SavedTabSpaceStore } from '../../../data/tabSpace/SavedTabSpaceStore';
import { TabSpace } from '../../../data/tabSpace/TabSpace';
import { TabSpaceRegistry } from '../../../tabSpaceRegistry/TabSpaceRegistry';
import classes from './SavedTabSpace.module.scss';
import { isIdNotSaved } from '../../../data/common';
import { observer } from 'mobx-react-lite';

export type ISavedTabSpaceProps = ISidebarComponentProps & {
  tabSpace: TabSpace;
  tabSpaceRegistry: TabSpaceRegistry;
  savedTabSpaceStore: SavedTabSpaceStore;
  savedTabSpaceCollection: SavedTabSpaceCollection;
};

export const SavedTabSpace = observer(
  ({
    tabSpaceRegistry,
    savedTabSpaceStore,
    savedTabSpaceCollection,
  }: ISavedTabSpaceProps) => {
    const openedSavedCount = tabSpaceRegistry.registry.reduce(
      (count, tabSpaceStub) => {
        return count + (isIdNotSaved(tabSpaceStub.id) ? 0 : 1);
      },
      0,
    );
    const [sortMethod, setSortMethod] = useState<SortMethods>(() => {
      return savedTabSpaceCollection
        ? savedTabSpaceCollection.sortMethod
        : SortMethods.CREATED;
    });

    useEffect(() => {
      setSortMethod(savedTabSpaceCollection.sortMethod);
    }, [savedTabSpaceCollection.sortMethod]);

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
          <HTMLSelect
            minimal={true}
            value={sortMethod}
            onChange={(e) => {
              savedTabSpaceCollection.setSortMethod(
                parseInt(e.currentTarget.value) as SortMethods,
              );
            }}
          >
            <option value={SortMethods.CREATED}>Created Time</option>
            <option value={SortMethods.SAVED}>Saved Time</option>
          </HTMLSelect>
        </div>
      </div>
    );
  },
);
