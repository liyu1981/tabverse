import { Button, ButtonGroup, Card, Checkbox } from '@blueprintjs/core';

import { CollapsibleLabel } from '../../common/CollapsibleLabel';
import { FavIcon } from '../../common/FavIcon';
import { Popover2 } from '@blueprintjs/popover2';
import React from 'react';
import { Tab } from '../../../data/tabSpace/Tab';
import classes from './TabCard.module.scss';
import clsx from 'clsx';

const TabDetailPreviewPanel = (props) => {
  return props.tab ? (
    <Card interactive={false} className={classes.previewCard}>
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
  ) : null;
};

interface TabBookmarkBtnProps {
  tab: Tab;
  isBookmarked: boolean;
  onBookmark: (tab: Tab) => void;
}

function TabBookmarkBtn({
  tab,
  isBookmarked,
  onBookmark,
}: TabBookmarkBtnProps) {
  return isBookmarked ? (
    <div></div>
  ) : (
    <Button
      icon="bookmark"
      minimal={true}
      onClick={() => {
        onBookmark(tab);
      }}
    />
  );
}

interface ITabCardProps {
  tab: Tab;
  needSelector?: boolean;
  needPreview?: boolean;
  tabPreview?: string;
  isBookmarked?: boolean;
  onBookmark?: (tab: Tab) => void;
  onSelect?: (tabId: string, selected: boolean) => void;
}

export function TabCard(props: ITabCardProps) {
  const needPreview = props.needPreview ?? false;
  const needSelector = props.needSelector ?? false;

  const switchToTab = (t: Tab) => {
    chrome.tabs.update(t.chromeTabId, { active: true });
  };

  const closeTab = (t: Tab) => {
    chrome.tabs.remove(t.chromeTabId);
  };

  const card = (
    <Card key={props.tab.id} interactive={true} className={classes.card}>
      <div className={classes.leftSide}>
        {needSelector ? (
          <Checkbox
            onChange={(ev) => {
              props.onSelect &&
                props.onSelect(props.tab.id, ev.currentTarget.checked);
            }}
          />
        ) : null}
        <FavIcon url={props.tab.favIconUrl} />
      </div>
      <div className={classes.rightSide}>
        {props.tab.chromeTabId ? (
          <ButtonGroup>
            {props.isBookmarked === undefined ? (
              ''
            ) : (
              <TabBookmarkBtn
                tab={props.tab}
                isBookmarked={props.isBookmarked}
                onBookmark={props.onBookmark}
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
  ) : null;

  return needPreview ? (
    <Popover2
      autoFocus={false}
      placement="right"
      interactionKind="hover"
      hoverOpenDelay={800}
      // isOpen={props.tab.title.startsWith('Blueprint') ? true : undefined}
      content={previewContent}
      enforceFocus={false}
      fill={true}
      portalClassName={classes.tabCardPopover}
    >
      {card}
    </Popover2>
  ) : (
    card
  );
}
