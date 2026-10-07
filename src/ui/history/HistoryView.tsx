import {
  Button,
  ButtonGroup,
  Intent,
  Popover,
  Position,
} from '@blueprintjs/core';
import { $allBookmark, bookmarkStoreApi } from '../../data/bookmark/store';
import { $allClosedTab } from '../../data/closedTab/store';
import {
  clearAllClosedTabs,
  deleteClosedTab,
  restoreClosedTab,
  startMonitorDbChanges,
} from '../../data/closedTab/util';
import React, { useContext, useEffect, useState } from 'react';

import {
  groupHistoryBySite,
  matchHistoryEntries,
} from '../../data/closedTab/historyFilter';
import {
  newEmptyBookmark,
  setFavIconUrl,
  setName,
  setUrl,
} from '../../data/bookmark/Bookmark';
import { ClosedTab } from '../../data/closedTab/ClosedTab';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { FavIcon } from '../common/FavIcon';
import { HistoryToolbar } from './HistoryToolbar';
import { ManagerViewContext } from '../manager/ManagerViewContext';
import { calendarLabel, fromNow } from '../../time';
import { saveCurrentBookmarks } from '../../data/bookmark/util';
import { usePageControl } from '../common/usePageControl';
import { useSettingItem } from '../../storage/localSetting';
import { useStore } from 'effector-react';
import classes from './HistoryView.module.scss';

/**
 * How many closed tabs a page holds.
 *
 * Ten, the same as the Bookmark tool (`BOOKMARK_PAGE_LIMIT`), so the two lists
 * a person flips between page the same way. A closed tab is a row of two lines
 * plus its controls, and twenty of them is a list that has to be scrolled to be
 * read at all; the page control exists to stop exactly that.
 */
const HISTORY_PAGE_LIMIT = 10;

/**
 * Whether the history is drawn in day groups, kept between visits to the page.
 *
 * A window-local ui preference, in the sidebar's rail flag's company
 * (`storage/localSetting`): the service worker has no use for it, and it is not
 * a record of anything, so it is not synced.
 */
const HISTORY_GROUPED_KEY = 'tabverse_history_grouped';

interface IHistoryItemProps {
  closedTab: ClosedTab;
  isBookmarked: boolean;
  restore: (closedTab: ClosedTab) => void;
  saveAsBookmark: (closedTab: ClosedTab) => void;
  remove: (closedTab: ClosedTab) => void;
}

const HistoryItem = (props: IHistoryItemProps) => {
  const closedTab = props.closedTab;
  return (
    <li>
      <div className={classes.listItemView}>
        <FavIcon className={classes.favIcon} url={closedTab.favIconUrl} />
        {/* the title is a button: clicking a closed tab is the most natural
            way to bring it back */}
        <button
          type="button"
          className={classes.label}
          title={`Reopen ${closedTab.title}`}
          onClick={() => props.restore(closedTab)}
        >
          <div className={classes.labelTitle}>{closedTab.title}</div>
          <small className={classes.labelUrl}>{closedTab.url}</small>
        </button>
        <small
          className={classes.labelTime}
          title={new Date(closedTab.closedAt).toLocaleString()}
        >
          {calendarLabel(closedTab.closedAt)}
          {closedTab.timesClosed > 1 ? ` x${closedTab.timesClosed}` : ''}
        </small>
        <ButtonGroup>
          <Button
            icon="undo"
            title="Reopen In Current Tabverse"
            minimal={true}
            onClick={() => props.restore(closedTab)}
          />
          <Button
            icon="bookmark"
            title={
              props.isBookmarked
                ? 'This page is already bookmarked'
                : 'Save as Bookmark (removes it from here)'
            }
            minimal={true}
            disabled={props.isBookmarked}
            onClick={() => props.saveAsBookmark(closedTab)}
          />
          <Button
            icon="trash"
            title="Forget It"
            minimal={true}
            onClick={() => props.remove(closedTab)}
          />
        </ButtonGroup>
      </div>
    </li>
  );
};

export interface HistoryEntriesProps {
  entries: ClosedTab[];
  /** One header per site, instead of one flat paged list. */
  grouped: boolean;
  isBookmarked: (url: string) => boolean;
  restore: (closedTab: ClosedTab) => void;
  saveAsBookmark: (closedTab: ClosedTab) => void;
  remove: (closedTab: ClosedTab) => void;
}

/**
 * The rows themselves: a flat list paged newest first, or the same entries
 * under one header per site.
 *
 * Exported for this file's tests, because this repo cannot press a switch (no
 * jsdom, AGENTS.md) and a grouped view nobody can render is a grouped view
 * nobody has looked at.
 *
 * The pager belongs to the flat list only. It pages rows, and a page that ends
 * in the middle of a site's rows would print that site's header on both pages -
 * which is the same answer twice, in a card whose whole job is to be read. The
 * grouped view is how a person sees what they were reading where, so it draws
 * all of it (a tabverse keeps up to 999 entries, `adr/0007`, which is what the
 * flat list pages in the first place) and the box above it is how a person
 * narrows that down.
 */
export function HistoryEntries(props: HistoryEntriesProps) {
  const [getCurrentPageItems, renderPageControl] = usePageControl<ClosedTab>(
    props.entries,
    HISTORY_PAGE_LIMIT,
  );

  const item = (closedTab: ClosedTab) => (
    <HistoryItem
      key={closedTab.id}
      closedTab={closedTab}
      isBookmarked={props.isBookmarked(closedTab.url)}
      restore={props.restore}
      saveAsBookmark={props.saveAsBookmark}
      remove={props.remove}
    />
  );

  if (props.grouped) {
    return (
      <div className={classes.groupedContainer}>
        {groupHistoryBySite(props.entries).map((group) => (
          <section key={group.site} className={classes.groupSection}>
            <div className={classes.groupHeader}>
              <span className={classes.groupLabel}>{group.site}</span>
              <span className={classes.groupCount}>{group.entries.length}</span>
            </div>
            <ul className={classes.listContainer}>{group.entries.map(item)}</ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div>
      <ul className={classes.listContainer}>
        {getCurrentPageItems().map(item)}
      </ul>
      <div className={classes.pageControlContainer}>{renderPageControl()}</div>
    </div>
  );
}

export function HistoryView() {
  const allClosedTab = useStore($allClosedTab);
  const allBookmark = useStore($allBookmark);
  const { toaster } = useContext(ManagerViewContext);
  // the box over the history; empty means the whole list, unchanged
  const [searchText, setSearchText] = useState<string>('');
  const [grouped, setGrouped] = useSettingItem<boolean>(
    HISTORY_GROUPED_KEY,
    (value) => value === 'true',
    (value) => (value ? 'true' : 'false'),
  );
  // window local, so absent means "not grouped" - the list the card has always
  // drawn
  const groupedByDay = grouped === true;

  useEffect(() => {
    // a tab closed in this tabverse on another device shows up as a database
    // write, not as a store event
    startMonitorDbChanges();
  }, []);

  const isBookmarked = (url: string): boolean =>
    allBookmark.bookmarks.findIndex((bookmark) => bookmark.url === url) >= 0;

  const restore = async (closedTab: ClosedTab) => {
    const restored = await restoreClosedTab(closedTab);
    if (!restored) {
      toaster.show({
        intent: Intent.DANGER,
        message: `Could not reopen ${closedTab.url}`,
      });
    }
  };

  const saveAsBookmark = (closedTab: ClosedTab) => {
    if (isBookmarked(closedTab.url)) {
      toaster.show({
        intent: Intent.WARNING,
        message: 'This page is already bookmarked.',
      });
      return;
    }
    bookmarkStoreApi.addBookmark(
      setFavIconUrl(
        closedTab.favIconUrl,
        setName(closedTab.title, setUrl(closedTab.url, newEmptyBookmark())),
      ),
    );
    saveCurrentBookmarks();
    // it lives in the Bookmark tool now, so it does not need to stay in the
    // history as well
    deleteClosedTab(closedTab.id);
    toaster.show({ message: 'Saved as bookmark.' });
  };

  const remove = (closedTab: ClosedTab) => {
    deleteClosedTab(closedTab.id);
  };

  const entries = allClosedTab.closedTabs.toArray();
  // what the card draws is the box's answer and nothing else: the group switch
  // is a second way of drawing the same list, never a second list to keep in
  // step with the first
  const matched = matchHistoryEntries(entries, searchText);

  const confirmClearAll = (
    <ButtonGroup>
      <Button
        icon="trash"
        intent={Intent.DANGER}
        text={`Clear all ${allClosedTab.closedTabs.size} entries`}
        onClick={() => {
          clearAllClosedTabs();
          toaster.show({ message: 'Closed tab history cleared.' });
        }}
      />
      <Button text="Cancel" minimal={true} />
    </ButtonGroup>
  );

  return (
    <ErrorBoundary>
      <div className={classes.container}>
        <div className={classes.header}>
          <span>
            {allClosedTab.closedTabs.size} closed tab
            {allClosedTab.closedTabs.size === 1 ? '' : 's'}
            {allClosedTab.closedTabs.size > 0
              ? `, last one ${fromNow(
                  allClosedTab.closedTabs.first().closedAt,
                )}`
              : ''}
          </span>
          <span className={classes.headerActions}>
            <Button
              icon="undo"
              title="Reopen The Last Closed Tab"
              minimal={true}
              small={true}
              disabled={allClosedTab.closedTabs.size <= 0}
              onClick={() => restore(allClosedTab.closedTabs.first())}
            />
            {allClosedTab.closedTabs.size > 0 ? (
              <Popover
                content={confirmClearAll}
                position={Position.BOTTOM_RIGHT}
                minimal={true}
              >
                <Button
                  icon="trash"
                  title="Clear The Whole History"
                  minimal={true}
                  small={true}
                />
              </Popover>
            ) : null}
          </span>
        </div>
        {allClosedTab.closedTabs.size <= 0 ? (
          <div className={classes.noticeContainer}>
            No tab closed in this tabverse yet. Every tab you close shows up
            here, ready to be reopened or saved as a bookmark.
          </div>
        ) : (
          <div>
            <HistoryToolbar
              value={searchText}
              onChange={setSearchText}
              matchCount={matched.length}
              totalCount={entries.length}
              grouped={groupedByDay}
              onToggleGrouped={() => setGrouped(!groupedByDay)}
            />
            {matched.length <= 0 ? (
              <div className={classes.noticeContainer}>
                Nothing in the history matches "{searchText.trim()}".
              </div>
            ) : (
              <HistoryEntries
                entries={matched}
                grouped={groupedByDay}
                isBookmarked={isBookmarked}
                restore={restore}
                saveAsBookmark={saveAsBookmark}
                remove={remove}
              />
            )}
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
