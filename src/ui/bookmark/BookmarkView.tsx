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

function createStyles(): { [k: string]: React.CSSProperties } {
  return {
    container: {
      background: '#fff',
      position: 'relative',
      border: '1px solid #ddd',
      color: '#111111',
    },
    listContainer: {
      margin: 0,
      padding: 0,
      listStyle: 'none',
    },
    listItemView: {
      display: 'flex',
      width: '100%',
      padding: '12px 12px',
      borderBottom: '1px solid #ededed',
    },
    favIcon: {
      marginRight: '18px',
    },
    label: {
      width: '98%',
      wordBreak: 'break-all',
    },
    noticeContainer: {
      background: '#fff',
      border: '1px solid #ddd',
      color: '#999',
      padding: '8px 18px',
      fontStyle: 'italic',
      fontWeight: 500,
    },
    pageControlContainer: {
      textAlign: 'center',
    },
  };
}

interface IBookmarkItem {
  bookmark: Bookmark;
}

const BookmarkItem = (props: IBookmarkItem) => {
  const styles = createStyles();
  const [name, setName] = useState(props.bookmark.name);
  return (
    <li>
      <div style={styles.listItemView}>
        <div style={styles.favIcon}>
          <img src={props.bookmark.favIconUrl} width="32" height="32" />
        </div>
        <label style={styles.label}>
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
  const styles = createStyles();

  const [getCurrentPageItems, renderPageControl] = usePageControl<Bookmark>(
    props.allBookmarkData.allBookmark.bookmarks.reverse().toArray(),
    BOOKMARK_PAGE_LIMIT,
  );

  const renderCurrentBookmarkItems = () => {
    return (
      <ul style={styles.listContainer}>
        {getCurrentPageItems().map((bookmark) => (
          <BookmarkItem key={bookmark.id} bookmark={bookmark} />
        ))}
      </ul>
    );
  };

  return (
    <ErrorBoundary>
      {getCurrentPageItems().length <= 0 ? (
        <div style={styles.noticeContainer}>
          No bookmark saved. You can save bookmark from left side tab entries.
        </div>
      ) : (
        <div style={styles.container}>
          <div>
            {renderCurrentBookmarkItems()}
            <div style={styles.pageControlContainer}>{renderPageControl()}</div>
          </div>
        </div>
      )}
    </ErrorBoundary>
  );
});
