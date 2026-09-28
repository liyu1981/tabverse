import { Button, Icon } from '@blueprintjs/core';
import React, { createContext, useContext } from 'react';

import classes from './SidebarContainer.module.scss';
import clsx from 'clsx';
import { useSettingItem } from '../../storage/localSetting';

interface SidebarState {
  collapsed: boolean;
  toggleCollapsed: () => void;
  /** used by the collapsed logo, which is the way back out of the rail */
  expandSidebar: () => void;
}

const SidebarContext = createContext<SidebarState>({
  collapsed: false,
  toggleCollapsed: () => undefined,
  expandSidebar: () => undefined,
});

/**
 * Whether the sidebar is collapsed to its icon rail. Read from the context
 * rather than passed down, because the three things that care about it (the
 * sidebar entries, the logo and the bottom nav) are siblings in the tree.
 */
export function useSidebarCollapsed(): boolean {
  return useContext(SidebarContext).collapsed;
}

export function useSidebarActions(): Pick<
  SidebarState,
  'toggleCollapsed' | 'expandSidebar'
> {
  const { toggleCollapsed, expandSidebar } = useContext(SidebarContext);
  return { toggleCollapsed, expandSidebar };
}

const COLLAPSED_KEY = 'tabverse_sidebar_collapsed';

// big enough to read at a glance against the brand-blue rail
const CHEVRON_ICON_SIZE = 20;

export const SidebarContainer = (props: { children?: React.ReactNode }) => {
  // a window-local ui preference; the service worker has no use for it
  const [collapsed, setCollapsed] = useSettingItem<boolean>(
    COLLAPSED_KEY,
    (v) => v === 'true',
    (v) => (v ? 'true' : 'false'),
  );
  const allChildren = React.Children.toArray(props.children);
  const sidebarContent = allChildren[0];
  const contentChildren = allChildren.slice(1);
  return (
    <SidebarContext.Provider
      value={{
        collapsed,
        toggleCollapsed: () => setCollapsed(!collapsed),
        expandSidebar: () => setCollapsed(false),
      }}
    >
      <div
        className={clsx(classes.topContainer, collapsed && classes.collapsed)}
      >
        <div className={classes.leftContainer}>
          {/* In the rail there is no room for the chevron: the logo is the way
              back out, so it becomes the button (see TabSpaceLogo). */}
          {!collapsed ? (
            <div className={classes.collapseToggle}>
              <Button
                minimal={true}
                large={true}
                icon={<Icon icon="chevron-left" size={CHEVRON_ICON_SIZE} />}
                title="Collapse the sidebar to icons"
                aria-label="Collapse sidebar"
                onClick={() => setCollapsed(true)}
              />
            </div>
          ) : null}
          {sidebarContent}
        </div>
        <div className={classes.rightContainer}>{contentChildren}</div>
      </div>
    </SidebarContext.Provider>
  );
};
