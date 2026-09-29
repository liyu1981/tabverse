import {
  Button,
  ButtonGroup,
  Card,
  Checkbox,
  Intent,
  Popover,
  Tag,
} from '@blueprintjs/core';

import { CollapsibleLabel } from '../../common/CollapsibleLabel';
import { FavIcon } from '../../common/FavIcon';
import React from 'react';
import { Tab } from '../../../data/tabSpace/Tab';
import classes from './TabCard.module.scss';
import clsx from 'clsx';

/**
 * How much of a tab's title / url a row shows before it cuts the rest off.
 *
 * The url used to take CollapsibleLabel's default of 70 characters, which is
 * wider than a tab row: a percent-encoded url (a japanese wikipedia page, a
 * long query string) runs to ~7px a character at this size, so 70 of them
 * overran the row and broke the card's layout. Measured against the popup's
 * 420px list (the tightest place we render these) 40 characters is what fits
 * on one line; 48 keeps an ordinary url on one line everywhere, and the worst
 * case only wraps instead of breaking the row. The full text stays in the
 * row's tooltip.
 */
const TAB_TITLE_MAX_LENGTH = 56;
const TAB_URL_MAX_LENGTH = 48;

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
            {props.tab.title}
          </h3>
        </div>
        <div className={classes.previewWrapText}>{props.tab.url}</div>
      </div>
      <div className={classes.previewImageContainer}>
        <img
          alt={`Preview of ${props.tab.title}`}
          className={classes.previewImage}
          src={props.tabPreview}
        />
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
      className="tv-icon-button"
      icon="bookmark"
      minimal={true}
      title="Save this tab as a bookmark"
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
  /**
   * What clicking the card does. Defaults to switching to the live tab; the
   * saved tabverse list passes its own (open this tab in a new window), which
   * is also why the card owns the click instead of being wrapped in a button:
   * a saved tab can sit inside a group block, and nesting a button around a
   * button is invalid markup that loses the inner one's styling.
   */
  onActivate?: (tab: Tab) => void;
}

export function TabCard(props: ITabCardProps) {
  const needPreview = props.needPreview ?? false;
  const needSelector = props.needSelector ?? false;

  const activate = (t: Tab) => {
    if (props.onActivate) {
      props.onActivate(t);
      return;
    }
    if (t.chromeTabId) {
      chrome.tabs.update(t.chromeTabId, { active: true });
    }
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
      <button
        type="button"
        className={clsx(classes.content, classes.contentButton)}
        title={props.tab.title}
        onClick={() => activate(props.tab)}
      >
        <div className={clsx(classes.tabTitle, classes.wrapText)}>
          <b>
            <CollapsibleLabel
              maxLength={TAB_TITLE_MAX_LENGTH}
              text={props.tab.title}
            />
          </b>
          {props.tab.pinned ? (
            <Tag
              minimal={true}
              icon="pin"
              intent={Intent.PRIMARY}
              className={classes.pinnedTag}
              title="This tab is pinned in Chrome"
            >
              pinned
            </Tag>
          ) : null}
        </div>
        <div className={clsx(classes.tabUrl, classes.wrapText)}>
          <small>
            <CollapsibleLabel
              maxLength={TAB_URL_MAX_LENGTH}
              text={props.tab.url}
            />
          </small>
        </div>
      </button>
      {/* after the content, because the card is a flex row: source order is
          layout order, the close button has to come last to sit on the right */}
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
              className="tv-icon-button"
              icon="cross"
              minimal={true}
              title="Close this tab"
              onClick={() => {
                closeTab(props.tab);
              }}
            />
          </ButtonGroup>
        ) : (
          <></>
        )}
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
    <Popover
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
    </Popover>
  ) : (
    card
  );
}
