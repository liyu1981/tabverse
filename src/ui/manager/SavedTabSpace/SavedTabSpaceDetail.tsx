import { formatDateTime, fromNow } from '../../../time';
import { Alignment, Button, ButtonGroup } from '@blueprintjs/core';
import React from 'react';

import { SplitBlock, TabGroupBlock } from '../TabSpace/TabGroupBlock';
import { TabCard } from '../TabSpace/TabCard';
import { TabSpace } from '../../../data/tabSpace/TabSpace';
import { TabSpaceId } from '../../../message/message';
import classes from './SavedTabSpaceDetail.module.scss';
import { createNewChromeWindowWithTab } from '../../../data/tabSpace/chromeUtil';
import { logger } from '../../../global';
import { TabSpaceQuery } from '../../../data/tabSpaceQuery/TabSpaceQuery';
import { Tab, TabCore } from '../../../data/tabSpace/Tab';
import { deleteSavedTabSpace } from '../../../data/tabSpace/util';
import { tabverseEntries } from '../../../data/tabSpace/tabEntries';

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
  const savedTabCard = (savedTab: Tab) => (
    <TabCard key={savedTab.id} tab={savedTab} onActivate={openTabInNewWindow} />
  );

  // A saved tabverse has to show what it actually holds: its tab groups and its
  // split views are part of the record, and this is the view a user opens to
  // remember what was in it. The entries come from the same builder the live
  // tab list uses, so the two cannot drift apart.
  const entries: React.ReactNode[] = [];
  for (const entry of tabverseEntries(props.tabSpace)) {
    if (entry.kind === 'tab') {
      entries.push(savedTabCard(entry.tab));
    } else if (entry.kind === 'split') {
      const [first, second] = entry.tabs as [Tab, Tab];
      entries.push(
        <SplitBlock
          key={`split-${first.splitViewId}`}
          splitViewId={first.splitViewId}
        >
          {savedTabCard(first)}
          {savedTabCard(second)}
        </SplitBlock>,
      );
    } else {
      entries.push(
        <TabGroupBlock
          key={`group-${entry.group.id}`}
          group={entry.group}
          tabCount={entry.tabs.length}
        >
          {entry.tabs.map((tab) => savedTabCard(tab))}
        </TabGroupBlock>,
      );
    }
  }
  const tabCount = props.tabSpace.tabs.size;

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
              Created <b>{fromNow(props.tabSpace.createdAt)}</b> at <br />
              {formatDateTime(props.tabSpace.createdAt)}
            </div>
            <div className={classes.tabSpaceTimeInfo}>
              Saved <b>{fromNow(props.tabSpace.updatedAt)}</b> at <br />
              {formatDateTime(props.tabSpace.updatedAt)}
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
              title="Load into this window: the tabs it already has open are kept, the rest are closed"
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
          Working on <b>{tabCount}</b> {tabCount === 1 ? 'tab' : 'tabs'}
          {props.tabSpace.tabGroups.length > 0
            ? ` in ${props.tabSpace.tabGroups.length} ${
                props.tabSpace.tabGroups.length === 1 ? 'group' : 'groups'
              }`
            : ''}
        </p>
        {entries}
      </div>
    </div>
  );
}
