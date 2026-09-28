import { $allBookmark, bookmarkStoreApi } from '../../../data/bookmark/store';
import { $tabSpace, $tabSpacePreviewCache } from '../../../data/tabSpace/store';
import {
  Button,
  ButtonGroup,
  EditableText,
  Intent,
  Menu,
  MenuItem,
  Popover,
  Tag,
  Tooltip,
} from '@blueprintjs/core';
import React, { useEffect, useState } from 'react';
import {
  findTabById,
  getTabIds,
  TabGroupHint,
} from '../../../data/tabSpace/TabSpace';
import {
  TAB_GROUP_COLORS_JS,
  groupOfTab,
} from '../../../data/tabSpace/tabGroup';
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
import { Tab, findSplitPartner } from '../../../data/tabSpace/Tab';
import { TabCard } from './TabCard';
import classes from './TabSpaceListView.module.scss';
import { getPreview } from '../../../data/tabSpace/TabPreviewCache';
import { saveCurrentAllBookmarkIfNeeded } from '../../../data/bookmark/util';
import { updateTabSpaceName } from '../../../data/tabSpace/chromeTab';
import { useStore } from 'effector-react';

enum SelectedTabTool {
  MoveToExistTabverse = 'Move to Exist Tabverse',
}

/** What one row of the tab list renders: a tab, a split pair, or a group. */
type TabverseEntry =
  | { kind: 'tab'; tab: Tab }
  | { kind: 'split'; tabs: [Tab, Tab] }
  | { kind: 'group'; group: TabGroupHint; tabs: Tab[] };

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

  useEffect(() => {
    setSelectedTabs((lastSelectedTabs) => {
      return lastSelectedTabs
        .filter((tab) => tabSpace.tabs.findIndex((t) => t.id === tab.id) >= 0)
        .toList();
    });
  }, [tabSpace.tabs]);

  const tabIdOrder = getTabIds(tabSpace);
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

  // Entries are built as a list first, because two of them are composites: a
  // tab group (header + coloured rule around its tabs) and a split view (two
  // tabs Chrome shows side by side, drawn as one connected block). Order
  // follows the tabverse's own tab order, so a composite appears where its
  // first tab is.
  const groupedTabIds = new Set(
    (tabSpace.tabGroups ?? []).flatMap((group) => group.tabIds),
  );
  const consumedTabIds = new Set<string>();
  const entries: TabverseEntry[] = [];

  for (const tabId of tabIdOrder) {
    if (consumedTabIds.has(tabId) || groupedTabIds.has(tabId)) {
      continue;
    }
    const tab = findTabById(tabId, tabSpace);
    if (!tab) {
      continue;
    }
    consumedTabIds.add(tabId);
    const partner = findSplitPartner(tab, tabSpace.tabs);
    if (partner && tabIdOrder.indexOf(partner.id) >= 0) {
      consumedTabIds.add(partner.id);
      entries.push({ kind: 'split', tabs: [tab, partner] });
    } else {
      entries.push({ kind: 'tab', tab });
    }
  }

  // groups whose tabs are all out of view (search/filter) still get a header
  const groupEntries: TabverseEntry[] = (tabSpace.tabGroups ?? [])
    .filter((group) => !group.tabIds.every((id) => consumedTabIds.has(id)))
    .map((group) => ({
      kind: 'group' as const,
      group,
      tabs: group.tabIds
        .filter((tabId) => tabIdOrder.indexOf(tabId) >= 0)
        .map((tabId) => findTabById(tabId, tabSpace))
        .filter((tab): tab is Tab => !!tab),
    }));

  const tabEntries: React.ReactNode[] = [];
  for (const entry of [...entries, ...groupEntries]) {
    if (entry.kind === 'tab') {
      tabEntries.push(tabCard(entry.tab));
    } else if (entry.kind === 'split') {
      const [first, second] = entry.tabs as [Tab, Tab];
      tabEntries.push(
        <div key={`split-${first.splitViewId}`} className={classes.splitView}>
          <div className={classes.splitHeader}>
            <span className={classes.splitIcon}>&#9101;</span>
            split view
          </div>
          {tabCard(first)}
          {tabCard(second)}
        </div>,
      );
    } else {
      const group = entry.group;
      if (!entry.tabs || entry.tabs.length === 0) {
        continue;
      }
      tabEntries.push(
        <div
          key={`group-${group.id}`}
          className={classes.tabGroup}
          style={{ borderColor: TAB_GROUP_COLORS_JS[group.color] }}
        >
          <div className={classes.tabGroupHeader}>
            <span
              className={classes.tabGroupDot}
              style={{ backgroundColor: TAB_GROUP_COLORS_JS[group.color] }}
            />
            <span className={classes.tabGroupTitle}>
              {group.title || '(untitled group)'}
            </span>
            <small className={classes.tabGroupCount}>{entry.tabs.length}</small>
          </div>
          {entry.tabs.map(tabCard)}
        </div>,
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
        <Tooltip content="This tabverse is saved automatically. Opening a Tabverse tab is what keeps these tabs.">
          <Tag
            minimal={true}
            icon="floppy-disk"
            intent={Intent.NONE}
            className={classes.autoSaveTag}
          >
            auto save
          </Tag>
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
