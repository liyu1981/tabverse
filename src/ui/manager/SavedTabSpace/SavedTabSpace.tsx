import * as Moment from 'moment';
import * as React from 'react';

import { Button, Card, Colors, Elevation, Icon, Tag } from '@blueprintjs/core';
import {
  TabSpaceMsg,
  TabSpaceRegistryMsg,
  sendChromeMessage,
} from '../../../message';
import {
  TabSpaceRegistry,
  TabSpaceStub,
} from '../../../data/tabSpace/TabSpaceRegistry';

import { IndicatorLine } from '../../common/IndicatorLine';
import { PagingControl } from '../../common/PagingControl';
import { SavedTabSpaceCollection } from '../../../data/tabSpace/SavedTabSpaceCollection';
import { SavedTabSpaceDetail } from './SavedTabSpaceDetail';
import { SavedTabSpaceStore } from '../../../data/tabSpace/SavedTabSpaceStore';
import { SearchInput } from './Search';
import { StickyContainer } from '../../common/StickyContainer';
import { TabSpace } from '../../../data/tabSpace/TabSpace';
import { TabSpaceOp } from '../../../global';
import classes from './SavedTabSpace.module.scss';
import { observer } from 'mobx-react-lite';
import { useAsyncEffect } from '../../common/useAsyncEffect';
import { useMemo } from 'react';

function OpenedSavedTabSpaceCard({
  tabSpaceStub,
}: {
  tabSpaceStub: TabSpaceStub;
}) {
  return (
    <Card style={{ marginBottom: '8px', padding: '8px 18px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <Tag>Opended</Tag>
        </div>
        <div>
          <span style={{ fontSize: '1.4em', marginRight: '8px' }}>
            <b>{tabSpaceStub.name}</b>
          </span>
          <span style={{ color: Colors.GRAY3, marginRight: '8px' }}>
            Created {Moment(tabSpaceStub.createdAt).fromNow()}
          </span>
          <span style={{ color: Colors.GRAY3, marginRight: '8px' }}>
            Saved {Moment(tabSpaceStub.updatedAt).fromNow()}
          </span>
        </div>
        <div>
          <Button minimal={true}>
            <Icon icon="th-derived" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

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
          sendChromeMessage({
            type: TabSpaceMsg.Focus,
            payload: tabSpaceStub.chromeTabId,
          });
          chrome.windows.update(tabSpaceStub.chromeWindowId, { focused: true });
        }
      },
      [],
    );

    const restoreSavedTabSpace = useMemo(
      () => (tabSpace: TabSpace) => {
        chrome.windows.create((window) => {
          chrome.tabs.create({
            active: true,
            pinned: true,
            url: `manager.html?op=${TabSpaceOp.LoadSaved}&stsid=${tabSpace.id}`,
            windowId: window.id,
          });
        });
      },
      [],
    );

    const loadToCurrentWindow = useMemo(
      () => (stsid: string) => {
        async function action() {
          sendChromeMessage({
            type: TabSpaceRegistryMsg.RemoveTabSpace,
            payload: tabSpace.id,
          });
          window.open(
            `manager.html?op=${TabSpaceOp.LoadSaved}&stsid=${stsid}`,
            '_self',
          );
        }
        action();
      },
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
                  onChange={(terms) => {
                    savedTabSpaceCollection.setQueryTerms(terms);
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
