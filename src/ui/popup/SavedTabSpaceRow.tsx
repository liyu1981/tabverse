import { Button, ButtonGroup, Intent, Tag } from '@blueprintjs/core';
import React from 'react';

import { TabSpace } from '../../data/tabSpace/TabSpace';
import { t } from '../../i18n';
import { calendarLabel } from '../../time';
import { resolveSidebarColor } from '../../data/tabSpace/sidebarColor';
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
      {/* The tabverse's rail colour, as a bar so the list reads at a glance
          which one this window is showing. Decorative: the name and the
          "this window" tag are what a screen reader needs. */}
      <span
        className={classes.rowColorBar}
        style={{ backgroundColor: resolveSidebarColor(tabSpace.color) }}
        aria-hidden={true}
      />
      <button
        type="button"
        className={classes.rowLabel}
        title={isOpen ? t('popupRowGoTo') : t('popupRowAddToWindow')}
        onClick={() =>
          isOpen
            ? props.switchToOpen(tabSpace)
            : props.openInThisWindow(tabSpace)
        }
      >
        <div className={classes.rowName}>{tabSpace.name}</div>
        <div className={classes.rowMeta}>
          <span>
            {t(tabCount === 1 ? 'commonTabCountOne' : 'commonTabCountMany', [
              String(tabCount),
            ])}
          </span>
          <span>·</span>
          <span>{calendarLabel(tabSpace.updatedAt)}</span>
          {props.isCurrentWindow ? (
            <Tag minimal={true} intent={Intent.PRIMARY} round={true}>
              {t('popupThisWindow')}
            </Tag>
          ) : null}
          {isOpen && !props.isCurrentWindow ? (
            <span className={classes.rowBadge}>
              {t(
                props.openWindowCount === 1
                  ? 'popupOpenInWindowOne'
                  : 'popupOpenInWindowMany',
                [String(props.openWindowCount)],
              )}
            </span>
          ) : null}
        </div>
      </button>
      <ButtonGroup>
        {isOpen && !props.isCurrentWindow ? (
          <Button
            className="tv-icon-button"
            icon="locate"
            title={t('popupGoToWindowOfTabverse')}
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
          title={t(
            isOpen ? 'popupGoToWindowOfTabverse' : 'popupOpenInNewWindow',
          )}
          minimal={true}
          small={true}
          onClick={() => props.openInNewWindow(tabSpace)}
        />
      </ButtonGroup>
    </div>
  );
}
