import React, { useMemo } from 'react';
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
import { SavedTabSpaceCollection } from '../../../data/tabSpace/SavedTabSpaceCollection';
import { SavedTabSpaceDetail } from './SavedTabSpaceDetail';
import { SavedTabSpaceStore } from '../../../data/tabSpace/SavedTabSpaceStore';
import { SearchInput } from './Search';
import { SearchPagingControl } from '../../../fullTextSearch/SearchInput';
import { StickyContainer } from '../../common/StickyContainer';
import { TabSpace } from '../../../data/tabSpace/TabSpace';
import { TabSpaceRegistry } from '../../../tabSpaceRegistry/TabSpaceRegistry';
import classes from './SavedTabSpace.module.scss';
import { observer } from 'mobx-react-lite';
import { useAsyncEffect } from '../../common/useAsyncEffect';

export interface SavedTabSpaceProps {
  tabSpace: TabSpace;
  tabSpaceRegistry: TabSpaceRegistry;
  savedTabSpaceStore: SavedTabSpaceStore;
  savedTabSpaceCollection: SavedTabSpaceCollection;
}

export const SavedTabSpace = observer(
  ({
    tabSpace,
    tabSpaceRegistry,
    savedTabSpaceStore,
    savedTabSpaceCollection,
  }: SavedTabSpaceProps) => {
    useAsyncEffect(async () => {
      await savedTabSpaceCollection.load();
    }, [tabSpaceRegistry.registry, savedTabSpaceStore.savedDataVersion]);

    const switchToTabSpace = useMemo(
      () => (tabSpace: TabSpace) => {
        const tabSpaceStub = tabSpaceRegistry.registry.get(tabSpace.id);
        if (tabSpaceStub) {
          switchToTabSpaceUtil(
            tabSpaceStub.chromeTabId,
            tabSpaceStub.chromeWindowId,
          );
        }
      },
      [],
    );

    const restoreSavedTabSpace = useMemo(
      () => (tabSpace: TabSpace) => restoreSavedTabSpaceUtil(tabSpace.id),
      [],
    );

    const loadToCurrentWindow = useMemo(
      () => (savedTabSpaceId: string) =>
        loadToCurrentWindowUtil(tabSpace.chromeTabId, savedTabSpaceId),
      [],
    );

    const [groupLabelVerb, groupedSavedTabSpaces] =
      savedTabSpaceCollection.sortedGroupedSavedTabSpaces;

    const renderPagingControl = () => {
      let content = null;
      if (savedTabSpaceCollection.isSearchMode) {
        if (savedTabSpaceCollection.shouldShowSearchPaging) {
          const { availableCursors, currentCursorIndex, nextCursor } =
            savedTabSpaceCollection.cursorsForSearchPaging;
          content = (
            <SearchPagingControl
              cursors={availableCursors}
              currentCursorIndex={currentCursorIndex}
              nextCursor={nextCursor}
              onClickCursor={(cursorIndex) =>
                savedTabSpaceCollection.goQueryCursor(cursorIndex)
              }
              onClickMore={() => savedTabSpaceCollection.goQueryCursorNext()}
            />
          );
        }
      } else {
        if (savedTabSpaceCollection.totalPageCount > 1) {
          content = (
            <PagingControl
              current={savedTabSpaceCollection.queryPageStart + 1}
              total={savedTabSpaceCollection.totalPageCount}
              onNext={() => savedTabSpaceCollection.nextPage()}
              onPrev={() => savedTabSpaceCollection.prevPage()}
              onLast={() => savedTabSpaceCollection.lastPage()}
              onFirst={() => savedTabSpaceCollection.firstPage()}
            />
          );
        }
      }

      return content === null ? null : (
        <div className={classes.pagingControlContainer}>{content}</div>
      );
    };

    return (
      <div className={classes.container}>
        <div className={classes.tabSpaceListContainer}>
          <StickyContainer thresh={0} stickyOnClassName={classes.stickyOn}>
            <div className={classes.searchBar}>
              <SearchInput
                query={savedTabSpaceCollection.query}
                onChange={(query) => {
                  savedTabSpaceCollection.setQuery(query);
                }}
              />
            </div>
          </StickyContainer>
          <div>
            {savedTabSpaceCollection.loadStatus === LoadStatus.Loading ? (
              <div className={classes.loadingContainer}>
                <LoadingSpinner />
              </div>
            ) : null}
          </div>
          <div className={classes.savedContainer}>
            {groupedSavedTabSpaces.map(([m, savedTabSpaces]) => {
              return (
                <div key={m}>
                  <IndicatorLine>{`${savedTabSpaces.length} ${
                    savedTabSpaces.length <= 1 ? 'tabverse' : 'tabverses'
                  } ${groupLabelVerb} ${m}`}</IndicatorLine>
                  <div>
                    {savedTabSpaces.map((savedTabSpace) => {
                      return (
                        <Card
                          key={savedTabSpace.id}
                          className={classes.tabSpaceCard}
                        >
                          <div
                            className={
                              savedTabSpaceCollection.isTabSpaceOpened(
                                savedTabSpace.id,
                              )
                                ? classes.opened
                                : classes.notOpened
                            }
                          >
                            <div className={classes.inner}>opened</div>
                          </div>
                          <SavedTabSpaceDetail
                            key={savedTabSpace.id}
                            opened={savedTabSpaceCollection.isTabSpaceOpened(
                              savedTabSpace.id,
                            )}
                            tabSpace={savedTabSpace}
                            savedTabSpaceStore={savedTabSpaceStore}
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
    );
  },
);
