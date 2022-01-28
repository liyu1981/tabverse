import * as Moment from 'moment';
import * as React from 'react';

import { Button, Card, Colors, Elevation, Icon, Tag } from '@blueprintjs/core';
import {
  TabSpaceRegistry,
  TabSpaceStub,
} from '../../../data/tabSpace/TabSpaceRegistry';
import { TabSpaceRegistryMsg, sendChromeMessage } from '../../../message';

import { IndicatorLine } from '../../common/IndicatorLine';
import { SavedTabSpaceCollection } from '../../../data/tabSpace/SavedTabSpaceCollection';
import { SavedTabSpaceDetail } from './SavedTabSpaceDetail';
import { SavedTabSpaceStore } from '../../../data/tabSpace/SavedTabSpaceStore';
import { StickyContainer } from '../../common/StickyContainer';
import { TabSpace } from '../../../data/tabSpace/TabSpace';
import { TabSpaceOp } from '../../../global';
import classes from './SavedTabSpace.module.scss';
import { observer } from 'mobx-react-lite';
import { useAsyncEffect } from '../../common/useAsyncEffect';
import { useMemo } from 'react';
import { PagingControl } from '../../common/PagingControl';

function calcGroupedSavedTabSpaces(
  savedTabSpaces: TabSpace[],
): [string, TabSpace[]][] {
  return savedTabSpaces.reduce((groups, savedTabSpace) => {
    const m = Moment(savedTabSpace.createdAt).fromNow();
    if (groups.length <= 0) {
      groups.push([m, [savedTabSpace]]);
    } else {
      const [lastGroupM, lastGroup] = groups[groups.length - 1];
      if (lastGroupM !== m) {
        groups.push([m, [savedTabSpace]]);
      } else {
        lastGroup.push(savedTabSpace);
      }
    }
    return groups;
  }, []);
}

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

    const restoreSavedTabSpace = useMemo(
      () => (tabSpace: any) => {
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

    const groupedSavedTabSpaces = calcGroupedSavedTabSpaces(
      savedTabSpaceCollection.savedTabSpaces,
    );

    const renderPagingControl = () => {
      return (
        <PagingControl
          current={savedTabSpaceCollection.savedTabSpacesPageStart + 1}
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
            {savedTabSpaceCollection.openedSavedTabSpaces.length > 0 ? (
              <StickyContainer thresh={0} stickyOnClassName={classes.stickyOn}>
                <Card
                  elevation={Elevation.TWO}
                  className={classes.openedTabSpaceNoticeCard}
                >
                  {savedTabSpaceCollection.openedSavedTabSpaces.map(
                    (tabSpaceStub) => {
                      return (
                        <OpenedSavedTabSpaceCard
                          key={tabSpaceStub.id}
                          tabSpaceStub={tabSpaceStub}
                        />
                      );
                    },
                  )}
                </Card>
              </StickyContainer>
            ) : (
              <div></div>
            )}
            <div className={classes.savedContainer}>
              {groupedSavedTabSpaces.map(([m, savedTabSpaces]) => {
                return (
                  <div key={m}>
                    <IndicatorLine>{`${savedTabSpaces.length} ${
                      savedTabSpaces.length <= 1 ? 'tabverse' : 'tabverses'
                    } created ${m}`}</IndicatorLine>
                    <div>
                      {savedTabSpaces.map((savedTabSpace) => {
                        return (
                          <Card
                            key={savedTabSpace.id}
                            className={classes.tabSpaceCard}
                            elevation={Elevation.TWO}
                          >
                            <SavedTabSpaceDetail
                              key={savedTabSpace.id}
                              tabSpace={savedTabSpace}
                              savedTabSpaceStore={savedTabSpaceStore}
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
