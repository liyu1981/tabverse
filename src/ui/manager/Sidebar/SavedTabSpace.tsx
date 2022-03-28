import React, { useEffect, useState } from 'react';

import { HTMLSelect } from '@blueprintjs/core';
import { SidebarComponentProps } from './Sidebar';
import classes from './SavedTabSpace.module.scss';
import { isIdNotSaved } from '../../../data/common';
import { useStore } from 'effector-react';
import {
  $tabSpaceQuery,
  tabSpaceQueryStoreApi,
} from '../../../data/tabSpaceQuery/store';
import { $tabSpaceStorage } from '../../../data/tabSpace/store';
import { SortMethods } from '../../../data/tabSpaceQuery/TabSpaceQuery';
import { $tabSpaceRegistryState } from '../../../data/tabSpaceRegistry/store';

export type SavedTabSpaceProps = SidebarComponentProps;

export function SavedTabSpace(props: SavedTabSpaceProps) {
  const tabSpaceQuery = useStore($tabSpaceQuery);
  const tabSpaceStorage = useStore($tabSpaceStorage);
  const { tabSpaceRegistry } = useStore($tabSpaceRegistryState);

  const openedSavedCount = tabSpaceRegistry.reduce((count, tabSpaceStub) => {
    return count + (isIdNotSaved(tabSpaceStub.id) ? 0 : 1);
  }, 0);
  const [sortMethod, setSortMethod] = useState<SortMethods>(() => {
    return tabSpaceQuery ? tabSpaceQuery.sortMethod : SortMethods.CREATED;
  });

  useEffect(() => {
    setSortMethod(tabSpaceQuery.sortMethod);
  }, [tabSpaceQuery.sortMethod]);

  return (
    <div className={classes.noticeContainer}>
      <div className={classes.noticeLine}>
        <b>{`${tabSpaceStorage.totalSavedCount}`}</b> tabverses saved
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
            tabSpaceQueryStoreApi.setSortMethod(
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
}
