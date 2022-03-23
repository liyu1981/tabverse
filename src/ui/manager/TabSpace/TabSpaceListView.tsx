import {
  Button,
  ButtonGroup,
  EditableText,
  Intent,
  Menu,
  MenuItem,
} from '@blueprintjs/core';
import React, { useEffect, useState } from 'react';

import { ErrorBoundary } from '../../common/ErrorBoundary';
import { List } from 'immutable';
import { MoveToExistTabSpaceDialog } from '../../dialog/MoveToExistTabSpace';
import { Popover2 } from '@blueprintjs/popover2';
import { SaveIndicator } from './SaveIndicator';
import { Tab } from '../../../data/tabSpace/Tab';
import { TabCard } from './TabCard';
import { TabPreview } from '../../../data/tabSpace/TabPreview';
import { TabSpace } from '../../../data/tabSpace/TabSpace';
import classes from './TabSpaceListView.module.scss';
import { getSavedStoreManager } from '../../../store/bootstrap';
import { isIdNotSaved } from '../../../data/common';
import { observer } from 'mobx-react-lite';
import { saveCurrentTabSpace } from '../../../data/tabSpace/SavedTabSpaceStore';
import { updateTabSpaceName } from '../../../data/tabSpace/chromeTab';
import { $allBookmark, bookmarkStoreApi } from '../../../data/bookmark/store';
import {
  setName,
  setUrl,
  setFavIconUrl,
  newEmptyBookmark,
} from '../../../data/bookmark/Bookmark';
import { useStore } from 'effector-react';

enum SelectedTabTool {
  MoveToExistTabverse = 'Move to Exist Tabverse',
}

interface SelectedTabToolControlProps {
  className: string;
  onClick: (currentTool: SelectedTabTool) => void | Promise<void>;
}

function SelectedTabToolControl(props: SelectedTabToolControlProps) {
  const [currentTool, setCurrentTool] = useState<SelectedTabTool>(
    SelectedTabTool.MoveToExistTabverse,
  );

  const content = (
    <Menu>
      {Object.keys(SelectedTabTool).map((key) => {
        const text = SelectedTabTool[key];
        return (
          <MenuItem
            key={key}
            text={text}
            onClick={() => setCurrentTool(text as SelectedTabTool)}
          ></MenuItem>
        );
      })}
    </Menu>
  );
  return (
    <ButtonGroup className={props.className}>
      <Button onClick={() => props.onClick(currentTool)}>{currentTool}</Button>
      <Popover2 placement="bottom-end" content={content}>
        <Button icon="symbol-triangle-down"></Button>
      </Popover2>
    </ButtonGroup>
  );
}

interface TabSpaceListViewProps {
  tabSpace: TabSpace;
  tabPreview: TabPreview;
}

export const TabSpaceListView = observer(
  ({ tabSpace, tabPreview }: TabSpaceListViewProps) => {
    const allBookmark = useStore($allBookmark);

    const isBookmarked = (url: string): boolean => {
      return (
        allBookmark.bookmarks.findIndex((bookmark) => bookmark.url === url) >= 0
      );
    };

    const [title, setTitle] = useState(tabSpace.name);
    const [selectedTabs, setSelectedTabs] = useState<List<Tab>>(List());
    const [
      isMoveToExistTabSpaceDialogOpen,
      setIsMoveToExistTabSpaceDialogOpen,
    ] = useState(false);

    useEffect(() => {
      setSelectedTabs((lastSelectedTabs) => {
        return lastSelectedTabs
          .filter((tab) => tabSpace.tabs.findIndex((t) => t.id === tab.id) >= 0)
          .toList();
      });
    }, [tabSpace.tabs]);

    const onSaveCurrentTabSpace = () => {
      saveCurrentTabSpace();
    };

    const tabEntries = tabSpace.tabIds.map((tabId) => {
      const tab = tabSpace.findTabById(tabId);
      return tab ? (
        <div key={tab.id}>
          <ErrorBoundary>
            <TabCard
              tab={tab}
              needPreview={true}
              needSelector={true}
              tabPreview={tabPreview.getPreview(tab.chromeTabId)}
              isBookmarked={isBookmarked(tab.url)}
              onBookmark={(tab: Tab) => {
                bookmarkStoreApi.addBookmark(
                  setFavIconUrl(
                    tab.favIconUrl,
                    setName(tab.title, setUrl(tab.url, newEmptyBookmark())),
                  ),
                );
              }}
              onSelect={(tabId, selected) => {
                if (selected) {
                  setSelectedTabs((lastSelected) =>
                    lastSelected.push(tabSpace.findTabById(tabId)),
                  );
                } else {
                  setSelectedTabs((lastSelected) =>
                    lastSelected.filter((tab) => tab.id !== tabId).toList(),
                  );
                }
              }}
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
            className={isIdNotSaved(tabSpace.id) ? 'tv-primary-button' : ''}
            text={isIdNotSaved(tabSpace.id) ? 'Save' : 'Auto'}
            title={
              isIdNotSaved(tabSpace.id)
                ? 'Click to save and turn on auto save mode'
                : 'Auto save mode is on.'
            }
            icon="floppy-disk"
            intent={Intent.NONE}
            minimal={isIdNotSaved(tabSpace.id) ? false : true}
            onClick={onSaveCurrentTabSpace}
          />
        </div>
      </div>
    );

    const tabSpaceToolbarView = (
      <div className={classes.toolbarContainer}>
        <div className={classes.toolbarLeftContainer}>
          <div>
            <span>{`Working on ${tabSpace.tabs.size} tabs`}</span>
          </div>
        </div>
        {selectedTabs.size > 0 ? (
          <div className={classes.toolbarMiddleContainer}>
            <span className={classes.selectedTabsToolbarInfo}>{`Selected ${
              selectedTabs.size
            } ${selectedTabs.size > 1 ? 'tabs' : 'tab'}`}</span>
            <SelectedTabToolControl
              className={classes.selectedTabsToolbarToolControl}
              onClick={(currentTool) => {
                console.log('clicked', currentTool);
                if (currentTool === SelectedTabTool.MoveToExistTabverse) {
                  setIsMoveToExistTabSpaceDialogOpen(true);
                }
              }}
            />
          </div>
        ) : null}
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
      <div className={classes.stickyOn}>
        <div className={classes.header}>
          {tabSpaceTitleView}
          {tabSpaceToolbarView}
        </div>
        <div className={classes.headerPlaceholder}></div>
      </div>
    );

    return (
      <div className={classes.container}>
        {tabSpaceHeaderView}
        <div className={classes.tabEntriesContainer}>{tabEntries}</div>
        <div className={classes.bottomPlaceholder}></div>
        <MoveToExistTabSpaceDialog
          tabsForMoving={selectedTabs.toArray()}
          isOpen={isMoveToExistTabSpaceDialogOpen}
          onClose={() => setIsMoveToExistTabSpaceDialogOpen(false)}
        />
      </div>
    );
  },
);
