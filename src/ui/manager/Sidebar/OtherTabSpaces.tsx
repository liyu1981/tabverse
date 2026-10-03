import React from 'react';
import { Icon, IconName } from '@blueprintjs/core';
import { useStore } from 'effector-react';

import { ManagerViewRoute } from '../routes';
import {
  $otherWindowRows,
  OtherWindowRow,
  switchToOtherWindow,
} from '../../../data/tabSpace/openWindowStore';
import { SidebarComponent } from './Sidebar';
import { logger } from '../../../global';
import { useSidebarCollapsed } from '../../common/SidebarContainer';
import classes from './OtherTabSpaces.module.scss';

const ICON_SIZE = 20;

/** What a row calls its tabverse: its name, or its id until it has one. */
export function labelOfOtherTabSpace(row: OtherWindowRow): string {
  return row.name.length > 0 ? row.name : row.tabSpaceId;
}

/**
 * The tabverses open in this browser's other windows.
 *
 * One sidebar entry per window, which is what makes both shapes of the sidebar
 * fall out of one list:
 *
 *  - **expanded**, the entries read as rows under an "Other Tabverses" heading,
 *    each one its tabverse's name, each one a button that switches to it;
 *  - **collapsed**, the rail has no room for text, so the same entries become
 *    `th-derived` icons whose tooltip is that name - which is why the name is
 *    the rail label and not the word "tabverse".
 *
 * The list is empty on a profile with one window, and then nothing is rendered:
 * a heading over nothing is worse than nothing.
 */
export function OtherTabSpaces() {
  const collapsed = useSidebarCollapsed();
  const rows = useStore($otherWindowRows);

  if (rows.length <= 0) {
    return null;
  }

  const goTo = (row: OtherWindowRow) => {
    // the window can be closed between the list being drawn and the click
    switchToOtherWindow(row).catch((err) =>
      logger.error('could not switch to the other tabverse window', err),
    );
  };

  return (
    <>
      {collapsed ? null : (
        <div className={classes.otherHeader}>Other Tabverses</div>
      )}
      {rows.map((row) => {
        const label = labelOfOtherTabSpace(row);
        return (
          <SidebarComponent
            key={`other-${row.chromeWindowId}-${row.tabSpaceId}`}
            // never the active route: these entries switch windows, they do
            // not navigate this page
            active={false}
            route={ManagerViewRoute.Opened}
            railIcon={'th-derived' as IconName}
            railLabel={label}
            onSwitch={() => goTo(row)}
            header={
              <div
                className={classes.otherHeaderRow}
                // the name is truncated on screen; this is the whole of it
                title={label}
              >
                <Icon icon={'th-derived' as IconName} size={ICON_SIZE} />
                <span className={classes.otherName}>{label}</span>
              </div>
            }
          />
        );
      })}
    </>
  );
}
