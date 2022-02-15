import * as React from 'react';

import { Card, Elevation } from '@blueprintjs/core';
import {
  loadToCurrentWindowUtil,
  restoreSavedTabSpaceUtil,
  switchToTabSpaceUtil,
} from '../../../data/tabSpace/chromeUtil';

import { IndicatorLine } from '../../common/IndicatorLine';
import { PagingControl } from '../../common/PagingControl';
import { SavedTabSpaceCollection } from '../../../data/tabSpace/SavedTabSpaceCollection';
import { SavedTabSpaceDetail } from './SavedTabSpaceDetail';
import { SavedTabSpaceStore } from '../../../data/tabSpace/SavedTabSpaceStore';
import { SearchInput } from './Search';
import { StickyContainer } from '../../common/StickyContainer';
import { TabSpace } from '../../../data/tabSpace/TabSpace';
import { TabSpaceRegistry } from '../../../data/tabSpace/TabSpaceRegistry';
import classes from './SavedTabSpace.module.scss';
import { observer } from 'mobx-react-lite';
import { useAsyncEffect } from '../../common/useAsyncEffect';
import { useMemo } from 'react';

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
      await savedTabSpaceCollection.load(tabSpaceRegistry);
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
        loadToCurrentWindowUtil(tabSpace.id, savedTabSpaceId),
      [],
    );

    const [groupLabelVerb, groupedSavedTabSpaces] =
      savedTabSpaceCollection.sortedGroupedSavedTabSpaces;

    const renderPagingControl = () => {
      return (
        <PagingControl
          current={savedTabSpaceCollection.queryPageStart + 1}
          total={savedTabSpaceCollection.totalPageCount}
          onNext={savedTabSpaceCollection.nextPage}
          onPrev={savedTabSpaceCollection.prevPage}
        />
      );
    };

    return (
      <div>
        <div className={classes.container}>
          <div className={classes.tabSpaceListContainer}>
            <StickyContainer thresh={0} stickyOnClassName={classes.stickyOn}>
              <div className={classes.toolbar}>
                <SearchInput
                  onChange={(query) => {
                    savedTabSpaceCollection.setQuery(query);
                    savedTabSpaceCollection.load(tabSpaceRegistry);
                  }}
                />
              </div>
            </StickyContainer>
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
                            elevation={Elevation.TWO}
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
              <div className={classes.pagingControlContainer}>
                {savedTabSpaceCollection.totalPageCount > 1
                  ? renderPagingControl()
                  : ''}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  },
);
