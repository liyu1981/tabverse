import { IManagerQueryParams, ManagerViewRoute } from '../ManagerView';

import { BottomNav } from '../BottomNav/BottomNav';
import { ErrorBoundary } from '../../common/ErrorBoundary';
import { Icon, IconName } from '@blueprintjs/core';
import { LiveTabSpace } from './LiveTabSpace';
import React from 'react';
import { SavedTabSpace } from './SavedTabSpace';
import { TabSpaceLogo } from '../../common/TabSpaceLogo';
import { useSidebarCollapsed } from '../../common/SidebarContainer';
import classes from './Sidebar.module.scss';
import clsx from 'clsx';
import { isDebug } from '../../../debug';

export interface SidebarComponentProps {
  active: boolean;
}

export function SidebarComponent({
  active,
  route,
  header,
  railIcon,
  onSwitch,
  children,
}: SidebarComponentProps & {
  route: ManagerViewRoute;
  header: React.JSX.Element | React.JSX.Element;
  /** icon shown when the sidebar is collapsed to its rail */
  railIcon?: IconName;
  onSwitch: (value: ManagerViewRoute) => void;
  children?: React.JSX.Element | React.JSX.Element[];
}) {
  const collapsed = useSidebarCollapsed();
  return (
    <ErrorBoundary>
      <div
        className={clsx(
          classes.sidebarComponent,
          active ? classes.active : classes.inactive,
          collapsed && classes.collapsed,
        )}
      >
        {!collapsed ? <div className={classes.edge}> </div> : null}
        <div
          className={classes.header}
          title={collapsed ? railText(header) : undefined}
          onClick={() => onSwitch(route)}
        >
          {collapsed ? (
            <span className={classes.railIcon}>
              <Icon icon={railIcon ?? 'panel-table'} size={RAIL_ICON_SIZE} />
            </span>
          ) : (
            header
          )}
        </div>
        {!collapsed && active ? children : <></>}
      </div>
    </ErrorBoundary>
  );
}

/** the collapsed rail has no room for the label, so it becomes the tooltip */
function railText(header: React.ReactNode): string | undefined {
  if (typeof header === 'string') {
    return header;
  }
  const text = React.isValidElement(header)
    ? (header.props as { children?: React.ReactNode })?.children
    : undefined;
  return typeof text === 'string' ? text : undefined;
}

export interface ISidebarProps {
  route: ManagerViewRoute;
  switchRoute: (newRoute: ManagerViewRoute) => void;
  queryParams?: IManagerQueryParams;
  onCollapse?: () => void;
}

const ICON_SIZE = 20;
// bigger icons in the collapsed rail: the whole entry is the button there
const RAIL_ICON_SIZE = 26;

export const Sidebar = (props: ISidebarProps) => {
  return (
    <>
      <div>
        <TabSpaceLogo collapsed={useSidebarCollapsed()} />
      </div>
      <br />
      <div>
        {/* <SidebarSearch
          active={props.route === ManagerViewRoute.Search}
          onSwitch={(value) => props.switchRoute(value)}
        /> */}
        <SidebarComponent
          active={props.route === ManagerViewRoute.Opened}
          route={ManagerViewRoute.Opened}
          onSwitch={props.switchRoute}
          railIcon="panel-table"
          header={
            <div className={classes.sidebarHeaderContainer}>
              <Icon icon="panel-table" size={ICON_SIZE} /> Live Tabverses
            </div>
          }
        >
          <LiveTabSpace active={props.route === ManagerViewRoute.Opened} />
        </SidebarComponent>
        <SidebarComponent
          active={props.route === ManagerViewRoute.Saved}
          route={ManagerViewRoute.Saved}
          onSwitch={props.switchRoute}
          railIcon="git-repo"
          header={
            <div className={classes.sidebarHeaderContainer}>
              <Icon icon="git-repo" size={ICON_SIZE} /> Saved Tabverses
            </div>
          }
        >
          <SavedTabSpace active={props.route === ManagerViewRoute.Opened} />
        </SidebarComponent>
        {isDebug() ? (
          <SidebarComponent
            active={props.route === ManagerViewRoute.Webtool}
            route={ManagerViewRoute.Webtool}
            onSwitch={props.switchRoute}
            railIcon="build"
            header={
              <div className={classes.sidebarHeaderContainer}>
                <Icon icon="build" size={ICON_SIZE} /> My WebTools{' '}
              </div>
            }
          ></SidebarComponent>
        ) : null}
        <BottomNav />
      </div>
    </>
  );
};
