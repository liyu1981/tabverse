import React from 'react';
import {
  loadToCurrentWindowUtil,
  restoreSavedTabSpaceUtil,
  switchToTabSpaceUtil,
} from '../../../data/tabSpace/chromeUtil';

import { Card } from '@blueprintjs/core';
import { IndicatorLine } from '../../common/IndicatorLine';
import { LoadStatus } from '../../../global';
import { LoadingSpinner } from '../../common/LoadingSpinner';
import { PagingControl } from '../../common/PagingControl';
import { SavedTabSpaceDetail } from './SavedTabSpaceDetail';
import { SearchInput } from './Search';
import SimpleBar from 'simplebar-react';
import { TabSpace } from '../../../data/tabSpace/TabSpace';
import classes from './SavedTabSpaceView.module.scss';
import { useAsyncEffect } from '../../common/useAsyncEffect';
import { useStore } from 'effector-react';
import { $tabSpace, $tabSpaceStorage } from '../../../data/tabSpace/store';
import {
  $tabSpaceQuery,
  tabSpaceQueryStoreApi,
} from '../../../data/tabSpaceQuery/store';
import {
  getSortedGroupedSavedTabSpaces,
  isSearchMode,
  isTabSpaceOpened,
} from '../../../data/tabSpaceQuery/TabSpaceQuery';

export function SavedTabSpaceView() {
  const tabSpace = useStore($tabSpace);
  const tabStorage = useStore($tabSpaceStorage);
  const tabSpaceQuery = useStore($tabSpaceQuery);
  useAsyncEffect(async () => {
    await tabSpaceQueryStoreApi.reload();
  }, [tabSpace, tabStorage]);

  // Only this window's tabverse can be switched to: a manager page does not
  // know (or care) which window another tabverse is open in (ADR 0006).
  const switchToTabSpace = (target: TabSpace) => {
    if (target.id === tabSpace.id) {
      switchToTabSpaceUtil(tabSpace.chromeTabId, tabSpace.chromeWindowId);
    }
  };

  const restoreSavedTabSpace = (tabSpace: TabSpace) =>
    restoreSavedTabSpaceUtil(tabSpace.id);

  const loadToCurrentWindow = (savedTabSpaceId: string) =>
    loadToCurrentWindowUtil(savedTabSpaceId);

  const [groupLabelVerb, groupedSavedTabSpaces] =
    getSortedGroupedSavedTabSpaces(tabSpaceQuery);

  // Browsing and searching page the same way now: both end up with a list of
  // tabverses (ADR 0008 removed the index cursor).
  const renderPagingControl = () => {
    if (tabSpaceQuery.totalPageCount <= 1) {
      return null;
    }
    return (
      <div className={classes.pagingControlContainer}>
        <PagingControl
          current={tabSpaceQuery.queryPageStart + 1}
          total={tabSpaceQuery.totalPageCount}
          onNext={() => tabSpaceQueryStoreApi.nextPage()}
          onPrev={() => tabSpaceQueryStoreApi.prevPage()}
          onLast={() => tabSpaceQueryStoreApi.lastPage()}
          onFirst={() => tabSpaceQueryStoreApi.firstPage()}
        />
      </div>
    );
  };

  return (
    <SimpleBar style={{ height: '100vh' }}>
      <div className={classes.container}>
        <div className={classes.tabSpaceListContainer}>
          <div className={classes.stickyOn}>
            <div className={classes.searchBar}>
              <SearchInput
                query={tabSpaceQuery.query}
                onChange={(query) => {
                  tabSpaceQueryStoreApi.setQuery(query);
                }}
              />
              {isSearchMode(tabSpaceQuery) ? (
                <div className={classes.searchStatus}>
                  {tabSpaceQuery.totalPageCount} tabverse
                  {tabSpaceQuery.totalPageCount === 1 ? '' : 's'} found
                  {tabSpaceQuery.searchBackend === 'server'
                    ? ' (searched on the sync server)'
                    : ' (searched on this device)'}
                  {tabSpaceQuery.searchUnknownTabSpaceIds.length > 0
                    ? `, ${tabSpaceQuery.searchUnknownTabSpaceIds.length} not downloaded yet`
                    : ''}
                </div>
              ) : (
                ''
              )}
            </div>
            <div className={classes.stickyOnPlaceholder}></div>
          </div>
          <div>
            {tabSpaceQuery.loadStatus === LoadStatus.Loading ? (
              <div className={classes.loadingContainer}>
                <LoadingSpinner />
              </div>
            ) : null}
          </div>
          <div className={classes.savedContainer}>
            {groupedSavedTabSpaces.map(([m, savedTabSpaces]) => {
              return (
                <div key={m}>
                  <IndicatorLine>
                    &#8595;{' '}
                    {`${savedTabSpaces.length} ${
                      savedTabSpaces.length <= 1 ? 'tabverse' : 'tabverses'
                    } ${groupLabelVerb} ${m}`}{' '}
                    &#8595;
                  </IndicatorLine>
                  <div>
                    {savedTabSpaces.map((savedTabSpace) => {
                      return (
                        <Card
                          key={savedTabSpace.id}
                          className={classes.tabSpaceCard}
                        >
                          <div
                            className={
                              isTabSpaceOpened(savedTabSpace.id, tabSpaceQuery)
                                ? classes.opened
                                : classes.notOpened
                            }
                          >
                            <div className={classes.inner}>opened</div>
                          </div>
                          <SavedTabSpaceDetail
                            key={savedTabSpace.id}
                            opened={isTabSpaceOpened(
                              savedTabSpace.id,
                              tabSpaceQuery,
                            )}
                            tabSpace={savedTabSpace}
                            tabSpaceQuery={tabSpaceQuery}
                            switchFunc={switchToTabSpace}
                            restoreFunc={restoreSavedTabSpace}
                            loadToCurrentWindowFunc={loadToCurrentWindow}
                          />
                        </Card>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {renderPagingControl()}
          </div>
        </div>
      </div>
    </SimpleBar>
  );
}
