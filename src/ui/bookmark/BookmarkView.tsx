import { $allBookmark, bookmarkStoreApi } from '../../data/bookmark/store';
import { Button, ButtonGroup, EditableText } from '@blueprintjs/core';
import React, { useState } from 'react';
import { saveCurrentBookmarks } from '../../data/bookmark/util';

import { Bookmark } from '../../data/bookmark/Bookmark';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { ListFilter } from '../common/ListFilter';
import classes from './BookmarkView.module.scss';
import { filterByText } from '../../data/search/inMemorySearch';
import { usePageControl } from '../common/usePageControl';
import { useStore } from 'effector-react';

interface IBookmarkItem {
  bookmark: Bookmark;
}

const BookmarkItem = (props: IBookmarkItem) => {
  const [name, setName] = useState(props.bookmark.name);
  return (
    <li>
      <div className={classes.listItemView}>
        <div className={classes.favIcon}>
          {/* decorative: the bookmark title is right next to it */}
          <img
            alt=""
            aria-hidden={true}
            src={props.bookmark.favIconUrl}
            width="32"
            height="32"
          />
        </div>
        {/* a grouping row, not a form control (the eslint/biome "label must
            have a control" rule was right that <label> was the wrong element) */}
        <div className={classes.label}>
          <div>
            <b>
              <EditableText
                maxLength={256}
                value={name}
                selectAllOnFocus={false}
                onChange={(value) => setName(value)}
                onConfirm={() => {
                  bookmarkStoreApi.updateBookmark({
                    bid: props.bookmark.id,
                    changes: { name },
                  });
                  saveCurrentBookmarks();
                }}
              />
            </b>
          </div>
          <small>{props.bookmark.url}</small>
        </div>
        <span>
          <ButtonGroup>
            <Button
              icon="document-share"
              title="Open In Current Tabverse"
              minimal={true}
              onClick={() => {
                chrome.tabs.create({
                  active: true,
                  url: props.bookmark.url,
                });
              }}
            />
            <Button
              icon="trash"
              title="Delete It"
              minimal={true}
              onClick={() => {
                bookmarkStoreApi.removeBookmark(props.bookmark.id);
                saveCurrentBookmarks();
              }}
            />
          </ButtonGroup>
        </span>
      </div>
    </li>
  );
};

const BOOKMARK_PAGE_LIMIT = 10;

export function BookmarkView() {
  const allBookmark = useStore($allBookmark);
  const [filterText, setFilterText] = useState('');

  const allBookmarks = allBookmark.bookmarks.reverse().toArray();
  // in memory, before paging: the page control then pages the matches
  const filteredBookmarks = filterByText(
    allBookmarks,
    (bookmark) => `${bookmark.name} ${bookmark.url}`,
    filterText,
  );

  const [getCurrentPageItems, renderPageControl] = usePageControl<Bookmark>(
    filteredBookmarks,
    BOOKMARK_PAGE_LIMIT,
  );

  const renderCurrentBookmarkItems = () => {
    return (
      <ul className={classes.listContainer}>
        {getCurrentPageItems().map((bookmark) => (
          <BookmarkItem key={bookmark.id} bookmark={bookmark} />
        ))}
      </ul>
    );
  };

  return (
    <ErrorBoundary>
      {allBookmarks.length <= 0 ? (
        <div className={classes.noticeContainer}>
          No bookmark saved. You can save bookmark from left side tab entries.
        </div>
      ) : (
        <div className={classes.container}>
          <div className={classes.filterWrapper}>
            <ListFilter
              value={filterText}
              onChange={setFilterText}
              placeholder="filter these bookmarks…"
              count={filteredBookmarks.length}
              total={allBookmarks.length}
              ariaLabel="Filter these bookmarks"
            />
          </div>
          <div className={classes.listScroll}>
            {filteredBookmarks.length <= 0 ? (
              <div className={classes.noticeContainer}>
                No bookmark matches the filter.
              </div>
            ) : (
              renderCurrentBookmarkItems()
            )}
          </div>
          {filteredBookmarks.length > BOOKMARK_PAGE_LIMIT ? (
            <div className={classes.pageControlContainer}>
              {renderPageControl()}
            </div>
          ) : null}
        </div>
      )}
    </ErrorBoundary>
  );
}
