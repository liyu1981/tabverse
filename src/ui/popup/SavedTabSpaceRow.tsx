import { Button, ButtonGroup, Intent, Tag } from '@blueprintjs/core';
import React from 'react';

import { TabSpace } from '../../data/tabSpace/TabSpace';
import { calendarLabel } from '../../time';
import classes from './PopupView.module.scss';

export interface ISavedTabSpaceRowProps {
  tabSpace: TabSpace;
  /** How many windows have this tabverse open (ADR 0006 allows more than one). */
  openWindowCount: number;
  /** The copy in the window the popup was opened from. */
  isCurrentWindow: boolean;
  openInNewWindow: (tabSpace: TabSpace) => void;
  openInThisWindow: (tabSpace: TabSpace) => void;
  switchToOpen: (tabSpace: TabSpace) => void;
}

/**
 * One saved tabverse.
 *
 * The name is the primary action and it depends on the state: a tabverse that
 * is already open somewhere is *gone to*, not copied - opening a second copy of
 * a tabverse you already have open is how a profile fills up with duplicates.
 * One that is not open anywhere is **added to this window**: its tabs are
 * opened beside the ones already here, and the ones it shares with the window
 * are reused rather than reopened. "Open in a new window" stays a button of its
 * own, because that is the other thing a person may mean by "open this".
 */
export function SavedTabSpaceRow(props: ISavedTabSpaceRowProps) {
  const { tabSpace } = props;
  const isOpen = props.openWindowCount > 0;
  const tabCount = tabSpace.tabs.size;

  return (
    <div className={classes.row}>
      <button
        type="button"
        className={classes.rowLabel}
        title={isOpen ? 'Go to this tabverse' : 'Add to this window'}
        onClick={() =>
          isOpen
            ? props.switchToOpen(tabSpace)
            : props.openInThisWindow(tabSpace)
        }
      >
        <div className={classes.rowName}>{tabSpace.name}</div>
        <div className={classes.rowMeta}>
          <span>{`${tabCount} tab${tabCount === 1 ? '' : 's'}`}</span>
          <span>·</span>
          <span>{calendarLabel(tabSpace.updatedAt)}</span>
          {props.isCurrentWindow ? (
            <Tag minimal={true} intent={Intent.PRIMARY} round={true}>
              this window
            </Tag>
          ) : null}
          {isOpen && !props.isCurrentWindow ? (
            <span className={classes.rowBadge}>
              {`open in ${props.openWindowCount} window${
                props.openWindowCount === 1 ? '' : 's'
              }`}
            </span>
          ) : null}
        </div>
      </button>
      <ButtonGroup>
        {isOpen && !props.isCurrentWindow ? (
          <Button
            className="tv-icon-button"
            icon="locate"
            title="Go to the window of this tabverse"
            minimal={true}
            small={true}
            onClick={() => props.switchToOpen(tabSpace)}
          />
        ) : null}
        <Button
          className="tv-icon-button"
          icon="folder-shared"
          // the door this opens switches when the tabverse is already open
          // somewhere (openOrSwitchToTabSpace), so the title says which of the
          // two it will do rather than promising a new window either way
          title={
            isOpen
              ? 'Go to the window of this tabverse'
              : 'Open In A New Window'
          }
          minimal={true}
          small={true}
          onClick={() => props.openInNewWindow(tabSpace)}
        />
      </ButtonGroup>
    </div>
  );
}
