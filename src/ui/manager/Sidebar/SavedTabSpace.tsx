import React, { useEffect, useState } from 'react';

import { HTMLSelect } from '@blueprintjs/core';
import type { SidebarComponentProps } from './Sidebar';
import classes from './SavedTabSpace.module.scss';
import { useStore } from 'effector-react';
import {
  $tabSpaceQuery,
  tabSpaceQueryStoreApi,
} from '../../../data/tabSpaceQuery/store';
import { $tabSpace, $tabSpaceStorage } from '../../../data/tabSpace/store';
import { SortMethods } from '../../../data/tabSpaceQuery/TabSpaceQuery';
import { t } from '../../../i18n';

export type SavedTabSpaceProps = SidebarComponentProps;

export function SavedTabSpace(_props: SavedTabSpaceProps) {
  const tabSpaceQuery = useStore($tabSpaceQuery);
  const tabSpaceStorage = useStore($tabSpaceStorage);
  const _tabSpace = useStore($tabSpace);
  // a manager page owns one window, so at most one saved tabverse is loaded
  // here (the current one, which is saved from the moment it is opened)
  const openedSavedCount = 1;
  const [sortMethod, setSortMethod] = useState<SortMethods>(() => {
    return tabSpaceQuery ? tabSpaceQuery.sortMethod : SortMethods.CREATED;
  });

  useEffect(() => {
    setSortMethod(tabSpaceQuery.sortMethod);
  }, [tabSpaceQuery.sortMethod]);

  return (
    <div className={classes.noticeContainer}>
      <div className={classes.noticeLine}>
        <b>{`${tabSpaceStorage.totalSavedCount}`}</b>{' '}
        {t('sidebarSavedCountSuffix')}
      </div>
      {openedSavedCount > 0 ? (
        <div className={classes.noticeLine}>
          <b>{`${openedSavedCount}`}</b> {t('sidebarLoadedCountSuffix')}
        </div>
      ) : (
        ''
      )}
      <div className={classes.noticeLine}>
        {t('sidebarSortBy')}{' '}
        <HTMLSelect
          minimal={true}
          value={sortMethod}
          onChange={(e) => {
            tabSpaceQueryStoreApi.setSortMethod(
              parseInt(e.currentTarget.value, 10) as SortMethods,
            );
          }}
        >
          <option value={SortMethods.CREATED}>{t('sidebarSortCreated')}</option>
          <option value={SortMethods.SAVED}>{t('sidebarSortSaved')}</option>
        </HTMLSelect>
      </div>
    </div>
  );
}
