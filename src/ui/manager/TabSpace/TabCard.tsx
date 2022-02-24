import * as React from 'react';

import { Button, ButtonGroup, Card, Elevation, Icon } from '@blueprintjs/core';

import { Bookmark } from '../../../data/bookmark/Bookmark';
import { CollapsibleLabel } from '../../common/CollapsibleLabel';
import { FavIcon } from '../../common/FavIcon';
import { Popover2 } from '@blueprintjs/popover2';
import { Tab } from '../../../data/tabSpace/Tab';
import { getAllBookmarkData } from '../../../data/bookmark/bootstrap';
import { observer } from 'mobx-react-lite';
import classes from './TabCard.module.scss';
import clsx from 'clsx';

const TabDetailPreviewPanel = (props) => {
  return props.tab ? (
    <Card
      interactive={false}
      elevation={Elevation.ONE}
      className={classes.previewCard}
    >
      <div className={classes.previewHeaderContainer}>
        <div className={classes.previewTitle}>
          <FavIcon
            className={classes.previewFavIconContainer}
            url={props.tab.favIconUrl}
          />
          <h3 className={clsx(classes.previewWrapText, classes.previewTitleH)}>
            <a href="#">{props.tab.title}</a>
          </h3>
        </div>
        <div className={classes.previewWrapText}>{props.tab.url}</div>
      </div>
      <div className={classes.previewImageContainer}>
        <img className={classes.previewImage} src={props.tabPreview} />
      </div>
    </Card>
  ) : (
    <></>
  );
};

interface TabBookmarkBtnProps {
  tab: Tab;
  inBookmark: boolean;
}

const TabBookmarkBtn = observer(({ tab, inBookmark }: TabBookmarkBtnProps) => {
  return inBookmark ? (
    <div></div>
  ) : (
    <Button
      icon="bookmark"
      minimal={true}
      onClick={() => {
        const b = new Bookmark();
        b.name = tab.title;
        b.url = tab.url;
        b.favIconUrl = tab.favIconUrl;
        getAllBookmarkData().allBookmark.addBookmark(b);
      }}
    />
  );
});

interface ITabCardProps {
  tab: Tab;
  needPreview?: boolean;
  tabPreview?: string;
  inBookmark?: boolean;
  onMouseOver?: any;
  onMouseOut?: any;
}

export const TabCard = observer((props: ITabCardProps) => {
  const needPreview = props.needPreview ?? false;

  const switchToTab = (t: Tab) => {
    chrome.tabs.update(t.chromeTabId, { active: true });
  };

  const closeTab = (t: Tab) => {
    chrome.tabs.remove(t.chromeTabId);
  };

  const card = (
    <Card key={props.tab.id} interactive={true} className={classes.card}>
      <div className={classes.leftSide}>
        {props.tab.chromeTabId ? (
          <Icon className={classes.dragHandle} icon="drag-handle-vertical" />
        ) : (
          <></>
        )}
        <FavIcon url={props.tab.favIconUrl} />
      </div>
      <div className={classes.rightSide}>
        {props.tab.chromeTabId ? (
          <ButtonGroup>
            {props.inBookmark === undefined ? (
              ''
            ) : (
              <TabBookmarkBtn tab={props.tab} inBookmark={props.inBookmark} />
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
        className={classes.content}
        onClick={() => {
          props.tab.chromeTabId ? switchToTab(props.tab) : '';
        }}
      >
        <div className={clsx(classes.tabTitle, classes.wrapText)}>
          <b>
            <CollapsibleLabel maxLength={56} text={props.tab.title} />
          </b>
        </div>
        <div className={clsx(classes.tabUrl, classes.wrapText)}>
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
