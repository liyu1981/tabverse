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
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
import { ActiveTabSearch } from './ActiveTabSearch';
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
import { saveCurrentBookmarks } from '../../../data/bookmark/util';
import {
  tabverseEntries,
  tabverseTabs,
} from '../../../data/tabSpace/tabEntries';
import { filterActiveTabs } from '../../../data/tabSpace/activeTabFilter';
import { focusLiveTabUtil } from '../../../data/tabSpace/chromeUtil';
import { updateTabSpaceName } from '../../../data/tabSpace/chromeTab';
import { useStore } from 'effector-react';
import clsx from 'clsx';

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
  // the filter box over the live tabs; empty means the whole list, unchanged
  const [filterText, setFilterText] = useState<string>('');
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const isFiltering = filterText.trim().length > 0;

  // the window's own order, flattened: the box ranks matches, so it cannot
  // hand them back nested in the group and split blocks they came from
  const orderedTabs = useMemo(() => tabverseTabs(tabSpace), [tabSpace]);
  const matchedTabs = useMemo(
    () => filterActiveTabs(orderedTabs, filterText),
    [orderedTabs, filterText],
  );

  const onActiveMatchChange = useCallback((tab: Tab | null) => {
    setActiveTabId(tab ? tab.id : null);
  }, []);

  // `/` focuses the box from anywhere on the page, unless the user is already
  // typing somewhere - in the note editor or a text field `/` is just a slash
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        return;
      }
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // a tab can be closed while the box is filtering over the list
  useEffect(() => {
    if (activeTabId && !tabSpace.tabs.some((tab) => tab.id === activeTabId)) {
      setActiveTabId(null);
    }
  }, [activeTabId, tabSpace.tabs]);

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
    <div
      key={tab.id}
      className={clsx(
        tabGroupOf(tab) ? classes.tabInGroup : '',
        isFiltering && tab.id === activeTabId ? classes.tabIsActiveMatch : '',
      )}
    >
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
            saveCurrentBookmarks();
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
  if (isFiltering) {
    // a ranked, flat result list: the blocks exist to show the window's shape,
    // and a best-match-first answer to "which one is it" does not have one
    for (const tab of matchedTabs) {
      tabEntries.push(tabCard(tab));
    }
  } else {
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
        <Tooltip content="Save and close">
          <Button
            className="tv-icon-button"
            aria-label="Save and close this tabverse"
            icon="floppy-disk"
            minimal={true}
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
        <ActiveTabSearch
          value={filterText}
          onChange={setFilterText}
          matches={matchedTabs}
          totalCount={orderedTabs.length}
          inputRef={searchInputRef}
          onActivate={(tab: Tab) => void focusLiveTabUtil(tab)}
          onActiveMatchChange={onActiveMatchChange}
        />
        {tabSpaceToolbarView}
      </div>
    </div>
  );

  return (
    <div className={classes.container}>
      {tabSpaceHeaderView}
      <CapabilityWarning />
      <div className={classes.tabEntriesContainer}>{tabEntries}</div>
      {isFiltering && matchedTabs.length <= 0 ? (
        <div className={classes.noMatchNotice}>
          {`No tab of "${tabSpace.name || 'this tabverse'}" matches.`}
        </div>
      ) : null}
      <div className={classes.bottomPlaceholder}></div>
      <MoveToExistTabSpaceDialog
        tabsForMoving={selectedTabs.toArray()}
        isOpen={isMoveToExistTabSpaceDialogOpen}
        onClose={() => setIsMoveToExistTabSpaceDialogOpen(false)}
      />
    </div>
  );
}
