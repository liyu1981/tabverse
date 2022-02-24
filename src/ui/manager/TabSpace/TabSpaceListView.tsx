import * as React from 'react';

import { Button, EditableText, Intent } from '@blueprintjs/core';

import { AllBookmark } from '../../../data/bookmark/Bookmark';
import { ErrorBoundary } from '../../common/ErrorBoundary';
import { SaveIndicator } from './SaveIndicator';
import { Tab } from '../../../data/tabSpace/Tab';
import { TabCard } from './TabCard';
import { TabPreview } from '../../../data/tabSpace/TabPreview';
import { TabSpace } from '../../../data/tabSpace/TabSpace';
import { getSavedStoreManager } from '../../../store/bootstrap';
import { isIdNotSaved } from '../../../data/common';
import { observer } from 'mobx-react-lite';
import { saveCurrentTabSpace } from '../../../data/tabSpace/SavedTabSpaceStore';
import { updateTabSpaceName } from '../../../data/tabSpace/chromeTab';
import { useState } from 'react';
import classes from './TabSpaceListView.module.scss';
import { StickyContainer } from '../../common/StickyContainer';

function inBookmark(tab: Tab, allBookmark: AllBookmark): boolean {
  return (
    allBookmark.bookmarks.findIndex((bookmark) => bookmark.url === tab.url) >= 0
  );
}

interface TabSpaceListViewProps {
  tabSpace: TabSpace;
  tabPreview: TabPreview;
  allBookmark: AllBookmark;
}

export const TabSpaceListView = observer(
  ({ tabSpace, tabPreview, allBookmark }: TabSpaceListViewProps) => {
    const [title, setTitle] = useState(tabSpace.name);

    const tabEntries = tabSpace.tabIds.map((tabId) => {
      const tab = tabSpace.findTabById(tabId);
      return tab ? (
        <div key={tab.id}>
          <ErrorBoundary>
            <TabCard
              tab={tab}
              needPreview={true}
              tabPreview={tabPreview.getPreview(tab.chromeTabId)}
              inBookmark={inBookmark(tab, allBookmark)}
            />
          </ErrorBoundary>
        </div>
      ) : (
        <></>
      );
    });

    const tabSpaceTitleView = (
      <div className={classes.titleContainer}>
        <div className={classes.titleMain}>
          <h1 className={classes.titleH1}>
            <EditableText
              className={classes.editableTextFullwidth}
              alwaysRenderInput={true}
              maxLength={256}
              value={title}
              selectAllOnFocus={false}
              onChange={(value) => setTitle(value)}
              onConfirm={() => updateTabSpaceName(tabSpace, title)}
            />
          </h1>
        </div>
        <div className={classes.titleButtons}>
          <Button
            text={isIdNotSaved(tabSpace.id) ? 'Save' : 'Auto'}
            title={
              isIdNotSaved(tabSpace.id)
                ? 'Click to save and turn on auto save mode'
                : 'Auto save mode is on.'
            }
            icon="floppy-disk"
            intent={isIdNotSaved(tabSpace.id) ? Intent.PRIMARY : Intent.NONE}
            minimal={isIdNotSaved(tabSpace.id) ? false : true}
            onClick={() => saveCurrentTabSpace()}
          />
        </div>
      </div>
    );

    const tabSpaceToolbarView = (
      <div className={classes.toolbarContainer}>
        <div className={classes.toolbarLeftContainer}>
          <div>{`Working on ${tabSpace.tabs.size} tabs`}</div>
        </div>
        <div className={classes.toolbarRightContainer}>
          {tabSpace.needAutoSave() ? (
            <SaveIndicator {...getSavedStoreManager().savedStores} />
          ) : (
            'Auto Saving Off'
          )}
        </div>
      </div>
    );

    const tabSpaceHeaderView = (
      <StickyContainer thresh={0} stickyOnClassName={classes.stickyOn}>
        <div className={classes.header}>
          {tabSpaceTitleView}
          {tabSpaceToolbarView}
        </div>
      </StickyContainer>
    );

    return (
      <div className={classes.container}>
        {tabSpaceHeaderView}
        <div className={classes.tabEntriesContainer}>{tabEntries}</div>
        <div className={classes.bottomPlaceholder}></div>
      </div>
    );
  },
);
