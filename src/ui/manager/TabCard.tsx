import * as React from 'react';

import { Button, ButtonGroup, Card, Elevation, Icon } from '@blueprintjs/core';
import { useEffect, useState } from 'react';

import { Bookmark } from '../../data/bookmark/bookmark';
import { CollapsibleLabel } from '../common/CollapsibleLabel';
import { FavIcon } from '../common/FavIcon';
import { Popover2 } from '@blueprintjs/popover2';
import { Tab } from '../../data/tabSpace/tab';
import { getAllBookmarkData } from '../../data/bookmark/bootstrap';
import { merge } from 'lodash';
import { observer } from 'mobx-react-lite';

function createStyles(): { [k: string]: React.CSSProperties } {
  return {
    card: {
      marginTop: '6px',
      padding: '8px 12px',
      minHeight: '53px',
    },
    leftSide: {
      display: 'flex',
      float: 'left',
      marginTop: '10px',
    },
    dragHandle: {
      marginLeft: '-8px',
      marginRight: '10px',
      color: '#666',
      cursor: 'grab',
    },
    content: {
      display: 'block',
      paddingLeft: '44px',
      paddingRight: '64px',
    },
    rightSide: {
      display: 'flex',
      float: 'right',
      marginTop: '4px',
    },
    wrapText: {
      overflowWrap: 'break-word',
      wordWrap: 'break-word',
      hyphens: 'auto',
    },
    tabTitle: {
      fontSize: '1.2em',
    },
    tabUrl: {
      color: '#888',
    },
    previewHeaderContainer: {
      padding: '8px',
      borderBottom: '1px solid #ccc',
      backgroundColor: 'rgb(249, 249, 249)',
      borderRadius: '6px 6px 0px 0px',
    },
    previewFavIconContainer: {
      marginTop: '0px',
      marginRight: '10px',
    },
    previewCard: {
      padding: '0px',
      maxWidth: '524px',
    },
    previewTitleH: {
      display: 'inline-block',
      fontSize: '1.5em',
    },
    previewWrapText: {
      overflowWrap: 'break-word',
      wordWrap: 'break-word',
      hyphens: 'auto',
      wordBreak: 'break-all',
    },
    previewTitle: {
      display: 'flex',
      alignItems: 'center',
    },
    previewImageContainer: {
      padding: '12px',
    },
    previewImage: {
      boxShadow: `0 2.8px 2.2px rgba(0, 0, 0, 0.034),
                  0 6.7px 5.3px rgba(0, 0, 0, 0.048),
                  0 12.5px 10px rgba(0, 0, 0, 0.06),
                  0 22.3px 17.9px rgba(0, 0, 0, 0.072),
                  0 41.8px 33.4px rgba(0, 0, 0, 0.086),
                  0 100px 80px rgba(0, 0, 0, 0.12)`,
      borderRadius: '8px',
      maxWidth: '500px',
      maxHeight: '500px',
      border: '1px solid #ccc',
    },
  };
}

const TabDetailPreviewPanel = (props) => {
  const styles = createStyles();

  return props.tab ? (
    <Card
      interactive={false}
      elevation={Elevation.ONE}
      style={styles.previewCard}
    >
      <div style={styles.previewHeaderContainer}>
        <div style={styles.previewTitle}>
          <FavIcon
            url={props.tab.favIconUrl}
            containerStyle={styles.previewFavIconContainer}
          />
          <h3 style={merge(styles.previewWrapText, styles.previewTitleH)}>
            <a href="#">{props.tab.title}</a>
          </h3>
        </div>
        <div style={styles.previewWrapText}>{props.tab.url}</div>
      </div>
      <div style={styles.previewImageContainer}>
        <img style={styles.previewImage} src={props.tabPreview} />
      </div>
    </Card>
  ) : (
    <></>
  );
};

interface ITabCardProps {
  tab: Tab;
  needPreview?: boolean;
  tabPreview?: string;
  onMouseOver?: any;
  onMouseOut?: any;
}

export const TabCard = observer((props: ITabCardProps) => {
  const styles = createStyles();
  const needPreview = props.needPreview ?? false;

  const [inBookmark, setInBookmark] = useState(false);

  useEffect(() => {
    setInBookmark(
      getAllBookmarkData().allBookmark.bookmarks.findIndex(
        (bookmark) => bookmark.url === props.tab.url,
      ) >= 0,
    );
  }, [props.tab]);

  const switchToTab = (t: Tab) => {
    chrome.tabs.update(t.chromeTabId, { active: true });
  };

  const closeTab = (t: Tab) => {
    chrome.tabs.remove(t.chromeTabId);
  };

  const card = (
    <Card
      key={props.tab.id}
      interactive={true}
      elevation={Elevation.ONE}
      style={styles.card}
    >
      <div style={styles.leftSide}>
        {props.tab.chromeTabId ? (
          <Icon style={styles.dragHandle} icon="drag-handle-vertical" />
        ) : (
          <></>
        )}
        <FavIcon url={props.tab.favIconUrl} />
      </div>
      <div style={styles.rightSide}>
        {props.tab.chromeTabId ? (
          <ButtonGroup>
            {inBookmark ? (
              <></>
            ) : (
              <Button
                icon="bookmark"
                minimal={true}
                onClick={() => {
                  const b = new Bookmark();
                  b.name = props.tab.title;
                  b.url = props.tab.url;
                  b.favIconUrl = props.tab.favIconUrl;
                  getAllBookmarkData().allBookmark.addBookmark(b);
                  setInBookmark(true);
                }}
              />
            )}
            <Button
              icon="cross"
              minimal={true}
              onClick={() => {
                closeTab(props.tab);
              }}
            />
          </ButtonGroup>
        ) : (
          <></>
        )}
      </div>
      <div
        style={styles.content}
        onClick={() => {
          props.tab.chromeTabId ? switchToTab(props.tab) : '';
        }}
      >
        <div style={merge(styles.tabTitle, styles.wrapText)}>
          <b>
            <CollapsibleLabel maxLength={56} text={props.tab.title} />
          </b>
        </div>
        <div style={merge(styles.tabUrl, styles.wrapText)}>
          <small>
            <CollapsibleLabel text={props.tab.url} />
          </small>
        </div>
      </div>
    </Card>
  );

  const previewContent = needPreview ? (
    <TabDetailPreviewPanel
      tab={props.tab}
      tabPreview={props.tabPreview ?? ''}
    />
  ) : (
    <></>
  );

  return needPreview ? (
    <Popover2
      autoFocus={false}
      placement="right"
      interactionKind="hover"
      hoverOpenDelay={800}
      // isOpen={props.tab.title.startsWith('css trick') ? true : undefined}
      content={previewContent}
      enforceFocus={false}
      fill={true}
    >
      {card}
    </Popover2>
  ) : (
    card
  );
});
