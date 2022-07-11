import { $allBookmark, bookmarkStoreApi } from '../../data/bookmark/store';
import { Button, ButtonGroup, EditableText } from '@blueprintjs/core';
import React, { useEffect, useState } from 'react';
import {
  monitorTabSpaceChanges,
  saveCurrentAllBookmarkIfNeeded,
  startMonitorLocalStorageChanges,
  stopMonitorLocalStorageChanges,
} from '../../data/bookmark/util';

import { Bookmark } from '../../data/bookmark/Bookmark';
import { ErrorBoundary } from '../common/ErrorBoundary';
import classes from './BookmarkView.module.scss';
import { isIdNotSaved } from '../../data/common';
import { logger } from '../../global';
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
          <img src={props.bookmark.favIconUrl} width="32" height="32" />
        </div>
        <label className={classes.label}>
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
                  saveCurrentAllBookmarkIfNeeded();
                }}
              >
                {props.bookmark.name}
              </EditableText>
            </b>
          </div>
          <small>{props.bookmark.url}</small>
        </label>
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
                saveCurrentAllBookmarkIfNeeded();
              }}
            />
          </ButtonGroup>
        </span>
      </div>
    </li>
  );
};

export interface IBookmarkViewProps {
  tabSpaceId: string;
}

const BOOKMARK_PAGE_LIMIT = 10;

export function BookmarkView({ tabSpaceId }: IBookmarkViewProps) {
  const allBookmark = useStore($allBookmark);

  useEffect(() => {
    logger.info('bookmark start monitor tabspace, alltodo changes');
    monitorTabSpaceChanges();
  }, []);

  useEffect(() => {
    if (tabSpaceId && isIdNotSaved(tabSpaceId)) {
      logger.info('bookmark start monitor localstorage changes');
      startMonitorLocalStorageChanges();
      return () => {
        logger.info('todo stop monitor localstorage changes');
        stopMonitorLocalStorageChanges();
      };
    }
  }, [tabSpaceId]);

  const [getCurrentPageItems, renderPageControl] = usePageControl<Bookmark>(
    allBookmark.bookmarks.reverse().toArray(),
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
      {getCurrentPageItems().length <= 0 ? (
        <div className={classes.noticeContainer}>
          No bookmark saved. You can save bookmark from left side tab entries.
        </div>
      ) : (
        <div className={classes.container}>
          <div>
            {renderCurrentBookmarkItems()}
            <div className={classes.pageControlContainer}>
              {renderPageControl()}
            </div>
          </div>
        </div>
      )}
    </ErrorBoundary>
  );
}
