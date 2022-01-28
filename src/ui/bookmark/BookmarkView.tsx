import * as React from 'react';

import {
  AllBookmarkData,
  getAllBookmarkData,
} from '../../data/bookmark/bootstrap';
import { Button, ButtonGroup, EditableText } from '@blueprintjs/core';

import { Bookmark } from '../../data/bookmark/Bookmark';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { observer } from 'mobx-react-lite';
import { usePageControl } from '../common/usePageControl';
import { useState } from 'react';
import classes from './BookmarkView.module.scss';

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
                className="bp3-editable-text-fullwidth"
                maxLength={256}
                value={name}
                selectAllOnFocus={false}
                onChange={(value) => setName(value)}
                onConfirm={() => {
                  getAllBookmarkData().allBookmark.updateBookmark(
                    props.bookmark.id,
                    { name: name },
                  );
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
                getAllBookmarkData().allBookmark.removeBookmark(
                  props.bookmark.id,
                );
              }}
            />
          </ButtonGroup>
        </span>
      </div>
    </li>
  );
};

export interface IBookmarkViewProps {
  allBookmarkData: AllBookmarkData;
}

const BOOKMARK_PAGE_LIMIT = 10;

export const BookmarkView = observer((props: IBookmarkViewProps) => {
  const [getCurrentPageItems, renderPageControl] = usePageControl<Bookmark>(
    props.allBookmarkData.allBookmark.bookmarks.reverse().toArray(),
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
});
