import { IManagerQueryParams, ManagerViewRoute } from '../ManagerView';

import { BottomNav } from '../BottomNav/BottomNav';
import { ErrorBoundary } from '../../common/ErrorBoundary';
import { Icon, IconName, Tooltip } from '@blueprintjs/core';
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
  railLabel,
  onSwitch,
  children,
}: SidebarComponentProps & {
  route: ManagerViewRoute;
  header: React.JSX.Element | React.JSX.Element;
  /** icon shown when the sidebar is collapsed to its rail */
  railIcon?: IconName;
  /**
   * Label for the rail: the tooltip content and the button's accessible name.
   * Pass it explicitly - it is data, not something to be recovered from the
   * rendered header, which is why this used to come out empty.
   */
  railLabel?: string;
  onSwitch: (value: ManagerViewRoute) => void;
  children?: React.JSX.Element | React.JSX.Element[];
}) {
  const collapsed = useSidebarCollapsed();
  const collapsedLabel = collapsed
    ? (railLabel ?? railTextFromHeader(header))
    : undefined;
  const entryButton = (
    <button
      type="button"
      className={classes.header}
      // the rail has no room for the label, so it is the accessible name here
      // and the tooltip content; the native title attribute is deliberately
      // not used, it shows up as an unstyled browser bubble on top of this
      aria-label={collapsedLabel}
      onClick={() => onSwitch(route)}
    >
      {collapsed ? (
        <span className={classes.railIcon}>
          <Icon icon={railIcon ?? 'panel-table'} size={RAIL_ICON_SIZE} />
        </span>
      ) : (
        header
      )}
    </button>
  );
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
        {collapsedLabel ? (
          <Tooltip content={collapsedLabel} placement="right">
            {entryButton}
          </Tooltip>
        ) : (
          entryButton
        )}
        {!collapsed && active ? children : <></>}
      </div>
    </ErrorBoundary>
  );
}

/**
 * Recovers the text of a rendered header, for entries that do not pass an
 * explicit railLabel.
 *
 * The first version of this only looked at a single string child, which
 * silently produced nothing for the real headers - they are
 * `<div><Icon/> Live Tabverses</div>`, so the children are an *array*. Walk the
 * tree and join the text instead, and give up (rather than render an empty
 * tooltip) when there is none.
 */
export function railTextFromHeader(header: React.ReactNode): string | undefined {
  const parts: string[] = [];
  const collect = (node: React.ReactNode): void => {
    if (node === null || node === undefined || typeof node === 'boolean') {
      return;
    }
    if (typeof node === 'string' || typeof node === 'number') {
      parts.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(collect);
      return;
    }
    if (React.isValidElement(node)) {
      collect((node.props as { children?: React.ReactNode })?.children);
    }
  };
  collect(header);
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text : undefined;
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
          railLabel="Live Tabverses"
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
          railLabel="Saved Tabverses"
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
            railLabel="My WebTools"
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
