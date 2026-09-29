import { $allBookmark, bookmarkStoreApi } from '../../../data/bookmark/store';
import { $tabSpace, $tabSpacePreviewCache } from '../../../data/tabSpace/store';
import {
  Button,
  ButtonGroup,
  EditableText,
  Menu,
  MenuItem,
  Popover,
  Tooltip,
} from '@blueprintjs/core';
import React, { useEffect, useState } from 'react';
import {
  findTabById,
  getTabIds,
  TabGroupHint,
} from '../../../data/tabSpace/TabSpace';
import { groupOfTab } from '../../../data/tabSpace/tabGroup';
import {
  newEmptyBookmark,
  setFavIconUrl,
  setName,
  setUrl,
} from '../../../data/bookmark/Bookmark';

import { CapabilityWarning } from './CapabilityWarning';
import { ErrorBoundary } from '../../common/ErrorBoundary';
import { List } from 'immutable';
import { MoveToExistTabSpaceDialog } from '../../dialog/MoveToExistTabSpace';
import { SaveIndicator } from './SaveIndicator';
import { SplitBlock, TabGroupBlock } from './TabGroupBlock';
import { Tab } from '../../../data/tabSpace/Tab';
import { TabCard } from './TabCard';
import classes from './TabSpaceListView.module.scss';
import { getPreview } from '../../../data/tabSpace/TabPreviewCache';
import { logger } from '../../../global';
import { saveAndCloseTabSpace } from '../../../data/tabSpace/closeTabSpace';
import { saveCurrentAllBookmarkIfNeeded } from '../../../data/bookmark/util';
import { tabverseEntries } from '../../../data/tabSpace/tabEntries';
import { updateTabSpaceName } from '../../../data/tabSpace/chromeTab';
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
      <Popover placement="bottom-end" content={content}>
        <Button icon="symbol-triangle-down"></Button>
      </Popover>
    </ButtonGroup>
  );
}

export function TabSpaceListView() {
  const tabSpace = useStore($tabSpace);
  const tabPreviewCache = useStore($tabSpacePreviewCache);
  const allBookmark = useStore($allBookmark);

  const isBookmarked = (url: string): boolean => {
    return (
      allBookmark.bookmarks.findIndex((bookmark) => bookmark.url === url) >= 0
    );
  };

  const [title, setTitle] = useState(tabSpace.name);
  const [selectedTabs, setSelectedTabs] = useState<List<Tab>>(List());
  const [isMoveToExistTabSpaceDialogOpen, setIsMoveToExistTabSpaceDialogOpen] =
    useState(false);
  const [isClosing, setIsClosing] = useState(false);

  // The tabverse itself is saved on every tab event, so this button is not
  // about saving it: it flushes whatever is still pending (a note typed a
  // moment ago, say) and then closes the tabverse tab. The window's other tabs
  // stay open as ordinary Chrome tabs.
  const saveAndClose = async () => {
    if (isClosing) {
      return;
    }
    setIsClosing(true);
    try {
      await saveAndCloseTabSpace();
    } catch (err) {
      logger.error('could not save and close the tabverse', err);
      setIsClosing(false);
    }
  };

  useEffect(() => {
    setSelectedTabs((lastSelectedTabs) => {
      return lastSelectedTabs
        .filter((tab) => tabSpace.tabs.findIndex((t) => t.id === tab.id) >= 0)
        .toList();
    });
  }, [tabSpace.tabs]);

  const tabGroupOf = (tab: Tab) => groupOfTab(tabSpace.tabGroups, tab.id);

  const tabCard = (tab: Tab) => (
    <div key={tab.id} className={tabGroupOf(tab) ? classes.tabInGroup : ''}>
      <ErrorBoundary>
        <TabCard
          tab={tab}
          needPreview={true}
          needSelector={true}
          tabPreview={getPreview(tab.chromeTabId, tabPreviewCache)}
          isBookmarked={isBookmarked(tab.url)}
          onBookmark={(tab: Tab) => {
            bookmarkStoreApi.addBookmark(
              setFavIconUrl(
                tab.favIconUrl,
                setName(tab.title, setUrl(tab.url, newEmptyBookmark())),
              ),
            );
            saveCurrentAllBookmarkIfNeeded();
          }}
          onSelect={(tabId, selected) => {
            if (selected) {
              setSelectedTabs((lastSelected) =>
                lastSelected.push(findTabById(tabId, tabSpace)),
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
  );

  // Groups, split pairs and plain tabs come from the shared entry builder, so
  // this list and the saved tabverse list describe a tabverse the same way
  const tabEntries: React.ReactNode[] = [];
  for (const entry of tabverseEntries(tabSpace)) {
    if (entry.kind === 'tab') {
      tabEntries.push(tabCard(entry.tab));
    } else if (entry.kind === 'split') {
      const [first, second] = entry.tabs as [Tab, Tab];
      tabEntries.push(
        <SplitBlock
          key={`split-${first.splitViewId}`}
          splitViewId={first.splitViewId}
        >
          {tabCard(first)}
          {tabCard(second)}
        </SplitBlock>,
      );
    } else if (entry.tabs.length > 0) {
      tabEntries.push(
        <TabGroupBlock
          key={`group-${entry.group.id}`}
          group={entry.group}
          tabCount={entry.tabs.length}
        >
          <div className={classes.tabInGroup}>{entry.tabs.map(tabCard)}</div>
        </TabGroupBlock>,
      );
    }
  }

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
            onConfirm={() => updateTabSpaceName(title)}
          />
        </h1>
      </div>
      <div className={classes.titleButtons}>
        <Tooltip content="This tabverse is saved automatically. This flushes anything still pending (notes, todos, bookmarks, closed tabs) and then closes the Tabverse tab; the window's other tabs stay open as normal tabs.">
          <Button
            minimal={true}
            small={true}
            icon="floppy-disk"
            text="Save and close"
            loading={isClosing}
            onClick={() => void saveAndClose()}
          />
        </Tooltip>
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
              if (currentTool === SelectedTabTool.MoveToExistTabverse) {
                setIsMoveToExistTabSpaceDialogOpen(true);
              }
            }}
          />
        </div>
      ) : null}
      <div className={classes.toolbarRightContainer}>
        <SaveIndicator />
      </div>
    </div>
  );

  const tabSpaceHeaderView = (
    <div className={classes.stickyOn}>
      <div className={classes.header}>
        {tabSpaceTitleView}
        {tabSpaceToolbarView}
      </div>
    </div>
  );

  return (
    <div className={classes.container}>
      {tabSpaceHeaderView}
      <CapabilityWarning />
      <div className={classes.tabEntriesContainer}>{tabEntries}</div>
      <div className={classes.bottomPlaceholder}></div>
      <MoveToExistTabSpaceDialog
        tabsForMoving={selectedTabs.toArray()}
        isOpen={isMoveToExistTabSpaceDialogOpen}
        onClose={() => setIsMoveToExistTabSpaceDialogOpen(false)}
      />
    </div>
  );
}
