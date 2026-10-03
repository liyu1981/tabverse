import React from 'react';
import { Icon, IconName, Popover } from '@blueprintjs/core';
import { useStore } from 'effector-react';

import { ManagerViewRoute } from '../routes';
import {
  $otherWindowRows,
  OtherWindowRow,
  switchToOtherWindow,
} from '../../../data/tabSpace/openWindowStore';
import { SidebarComponent } from './Sidebar';
import { TabverseHoverPreview } from './TabverseHoverPreview';
import { logger } from '../../../global';
import { useSidebarCollapsed } from '../../common/SidebarContainer';
import classes from './OtherTabSpaces.module.scss';
import previewClasses from './TabverseHoverPreview.module.scss';

/** How long the pointer has to rest on a row before its tabs are shown. */
export const HOVER_PREVIEW_DELAY_MS = 1000;

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

  // The shared rules plus the state's own gap: the portal is outside the
  // sidebar's DOM, so this is the only place that knows whether the row was a
  // rail icon or a full row (see the scss).
  const portalClassName = `${previewClasses.panelPopover} ${
    collapsed
      ? previewClasses.panelPopoverRail
      : previewClasses.panelPopoverWide
  }`;

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
        // The row is a <button>, so what lands inside it is a span and no
        // focusable content: the panel is read-only and is portalled out by
        // Blueprint (see TabverseHoverPreview for why it has no buttons).
        // No `title` on the row: the browser's own tooltip appears after about
        // the same delay as the panel and lands underneath it, which is the
        // double label in the screenshot that prompted this. The full name is
        // in the panel's header (with a title there), and the row's own ellipsis
        // keeps a truncated name readable once it is up.
        const rowContent = (
          <div className={classes.otherHeaderRow}>
            <Icon icon={'th-derived' as IconName} size={ICON_SIZE} />
            <span className={classes.otherName}>{label}</span>
          </div>
        );
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
            header={rowContent}
            // The popover's target is the row's button, not the content inside
            // it: Blueprint gives its target tabindex and aria-haspopup, which
            // do not belong inside another button. `hover`, not `hover-target`:
            // the panel stays open while the pointer is on it, which a list
            // invites.
            //
            // In the collapsed rail this replaces the icon's tooltip, because
            // the panel's header says the tabverse's name anyway - so the rail
            // answers "which one is it" with the same panel, not a tooltip that
            // only repeats what it says.
            wrapHeader={(button) => (
              <Popover
                autoFocus={false}
                enforceFocus={false}
                interactionKind="hover"
                hoverOpenDelay={HOVER_PREVIEW_DELAY_MS}
                placement="right"
                // Zeroed: Blueprint's default is `[0, arrow/2]` = 15px of space
                // for an arrow we hide, and the gap is set in css instead (see
                // TabverseHoverPreview.module.scss), where the rail and the
                // expanded list can want different numbers.
                modifiers={{ offset: { options: { offset: [0, 0] } } }}
                content={
                  <div className={previewClasses.panel}>
                    <TabverseHoverPreview
                      name={label}
                      windowId={row.chromeWindowId}
                    />
                  </div>
                }
                portalClassName={portalClassName}
              >
                {button}
              </Popover>
            )}
          />
        );
      })}
    </>
  );
}
