import { Alignment, Button, ButtonGroup } from '@blueprintjs/core';
import React from 'react';

import Moment from 'moment';
import { TabCard } from '../TabSpace/TabCard';
import { TabSpace } from '../../../data/tabSpace/TabSpace';
import { TabSpaceId } from '../../../message/message';
import classes from './SavedTabSpaceDetail.module.scss';
import { createNewChromeWindowWithTab } from '../SessionBrowser/util';
import { logger } from '../../../global';
import { TabSpaceQuery } from '../../../data/tabSpaceQuery/TabSpaceQuery';
import { TabCore } from '../../../data/tabSpace/Tab';
import { deleteSavedTabSpace } from '../../../data/tabSpace/util';

interface SavedTabSpaceDetailProps {
  opened: boolean;
  tabSpace: TabSpace;
  tabSpaceQuery: TabSpaceQuery;
  switchFunc: (tabSpace: TabSpace) => void;
  restoreFunc: (tabSpace: TabSpace) => void;
  loadToCurrentWindowFunc: (tabSpaceId: TabSpaceId) => void;
}

export function SavedTabSpaceDetail(props: SavedTabSpaceDetailProps) {
  const openTabInNewWindow = (savedTab: TabCore) =>
    createNewChromeWindowWithTab((theChromeWindow) => {
      return [
        chrome.tabs.create({
          windowId: theChromeWindow.id,
          url: savedTab.url,
        }),
      ];
    });
  const entries: React.ReactElement[] = [];
  props.tabSpace.tabs.forEach((savedTab) => {
    entries.push(
      <div key={savedTab.id} onClick={() => openTabInNewWindow(savedTab)}>
        <TabCard key={savedTab.id} tab={savedTab} />
      </div>,
    );
  });

  const deleteTabSpace = (savedTabSpaceId: string) => {
    async function action() {
      logger.log('request to delete:', savedTabSpaceId);
      await deleteSavedTabSpace(savedTabSpaceId);
    }
    action();
  };

  return (
    <div className={classes.container}>
      <div className={classes.buttonGroupContainer}>
        <div className={classes.infoContainer}>
          <h2>{props.tabSpace.name}</h2>
          <div>
            <div className={classes.tabSpaceTimeInfo}>
              Created <b>{Moment(props.tabSpace.createdAt).fromNow()}</b> at{' '}
              <br />
              {Moment(props.tabSpace.createdAt).format(
                'MMMM Do YYYY, h:mm:ss a',
              )}
            </div>
            <div className={classes.tabSpaceTimeInfo}>
              Saved <b>{Moment(props.tabSpace.updatedAt).fromNow()}</b> at{' '}
              <br />
              {Moment(props.tabSpace.updatedAt).format(
                'MMMM Do YYYY, h:mm:ss a',
              )}
            </div>
          </div>
        </div>
        {props.opened ? (
          <ButtonGroup
            large={true}
            vertical={true}
            minimal={true}
            alignText={Alignment.LEFT}
          >
            <Button
              icon="duplicate"
              title="Switch to the window of this tabverse"
              onClick={() => {
                props.switchFunc(props.tabSpace);
              }}
            >
              Switch to Tabverse
            </Button>
          </ButtonGroup>
        ) : (
          <ButtonGroup
            large={true}
            vertical={true}
            minimal={true}
            alignText={Alignment.LEFT}
          >
            <Button
              icon="folder-shared"
              onClick={() => {
                props.restoreFunc(props.tabSpace);
              }}
              title="Load all tabs to new window"
            >
              Load to New
            </Button>
            <Button
              icon="folder-open"
              onClick={() => {
                props.loadToCurrentWindowFunc(props.tabSpace.id);
              }}
              title="Load all tabs to current window"
            >
              Load to Current
            </Button>
            <Button
              icon="trash"
              onClick={() => deleteTabSpace(props.tabSpace.id)}
            >
              Delete
            </Button>
          </ButtonGroup>
        )}
      </div>
      <div className={classes.savedTabsContainer}>
        <p>
          Working on <b>{entries.length}</b>{' '}
          {entries.length > 1 ? 'tabs' : 'tab'}
        </p>
        {entries}
      </div>
    </div>
  );
}
