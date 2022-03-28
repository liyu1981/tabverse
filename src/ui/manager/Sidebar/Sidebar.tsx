import { IManagerQueryParams, ManagerViewRoute } from '../ManagerView';
import React from 'react';

import { BottomNav } from '../BottomNav/BottomNav';
import { BrowserSession } from './BrowserSession';
import { ErrorBoundary } from '../../common/ErrorBoundary';
import { Icon } from '@blueprintjs/core';
import { LiveTabSpace } from './LiveTabSpace';
import { SavedTabSpace } from './SavedTabSpace';
import { TabSpaceLogo } from '../../common/TabSpaceLogo';
import classes from './Sidebar.module.scss';
import clsx from 'clsx';

export interface SidebarComponentProps {
  active: boolean;
}

export function SidebarComponent({
  active,
  route,
  header,
  onSwitch,
  children,
}: SidebarComponentProps & {
  route: ManagerViewRoute;
  header: JSX.Element | React.ReactFragment;
  onSwitch: (value: ManagerViewRoute) => void;
  children?: JSX.Element | JSX.Element[];
}) {
  return (
    <ErrorBoundary>
      <div
        className={clsx(
          classes.sidebarComponent,
          active ? classes.active : classes.inactive,
        )}
      >
        <div className={classes.edge}> </div>
        <div className={classes.header} onClick={() => onSwitch(route)}>
          {header}
        </div>
        {active ? children : <></>}
      </div>
    </ErrorBoundary>
  );
}

export interface ISidebarProps {
  route: ManagerViewRoute;
  switchRoute: (newRoute: ManagerViewRoute) => void;
  queryParams?: IManagerQueryParams;
  onCollapse?: () => void;
}

const ICON_SIZE = 20;

export const Sidebar = (props: ISidebarProps) => {
  return (
    <>
      <div>
        <TabSpaceLogo />
      </div>
      <br />
      <div>
        {/* <SidebarSearch
          active={props.route === ManagerViewRoute.Search}
          onSwitch={(value) => props.switchRoute(value)}
        /> */}
        <SidebarComponent
          active={props.route === ManagerViewRoute.Session}
          route={ManagerViewRoute.Session}
          onSwitch={props.switchRoute}
          header={
            <div className={classes.sidebarHeaderContainer}>
              <Icon icon="git-repo" size={ICON_SIZE} /> Browser Session
            </div>
          }
        >
          <BrowserSession active={props.route === ManagerViewRoute.Session} />
        </SidebarComponent>
        <SidebarComponent
          active={props.route === ManagerViewRoute.Opened}
          route={ManagerViewRoute.Opened}
          onSwitch={props.switchRoute}
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
          header={
            <div className={classes.sidebarHeaderContainer}>
              <Icon icon="git-repo" size={ICON_SIZE} /> Saved Tabverses
            </div>
          }
        >
          <SavedTabSpace active={props.route === ManagerViewRoute.Opened} />
        </SidebarComponent>
        <SidebarComponent
          active={props.route === ManagerViewRoute.Webtool}
          route={ManagerViewRoute.Webtool}
          onSwitch={props.switchRoute}
          header={
            <div className={classes.sidebarHeaderContainer}>
              <Icon icon="build" size={ICON_SIZE} /> My WebTools{' '}
            </div>
          }
        ></SidebarComponent>
        <BottomNav />
      </div>
    </>
  );
};
