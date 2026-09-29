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
 * Everything else is an explicit button, because "open in this window" replaces
 * the tabs of a window the user is working in.
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
        title={isOpen ? 'Go to this tabverse' : 'Open in a new window'}
        onClick={() =>
          isOpen
            ? props.switchToOpen(tabSpace)
            : props.openInNewWindow(tabSpace)
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
          title="Open In A New Window"
          minimal={true}
          small={true}
          onClick={() => props.openInNewWindow(tabSpace)}
        />
        <Button
          className="tv-icon-button"
          icon="folder-open"
          title="Open In This Window (replaces its tabs)"
          minimal={true}
          small={true}
          disabled={props.isCurrentWindow}
          onClick={() => props.openInThisWindow(tabSpace)}
        />
      </ButtonGroup>
    </div>
  );
}
