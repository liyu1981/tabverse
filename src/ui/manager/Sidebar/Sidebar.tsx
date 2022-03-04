import { IManagerQueryParams, ManagerViewRoute } from '../ManagerView';

import { BottomNav } from '../BottomNav/BottomNav';
import { BrowserSession } from './BrowserSession';
import { ErrorBoundary } from '../../common/ErrorBoundary';
import { Icon } from '@blueprintjs/core';
import { LiveTabSpace } from './LiveTabSpace';
import React from 'react';
import { SavedTabSpace } from './SavedTabSpace';
import { TabSpaceLogo } from '../../common/TabSpaceLogo';
import classes from './Sidebar.module.scss';
import clsx from 'clsx';
import { getAllChromeSessionData } from '../../../data/chromeSession/bootstrap';
import { getTabSpaceData } from '../../../data/tabSpace/bootstrap';
import { getTabSpaceRegistry } from '../../../tabSpaceRegistry';

export interface ISidebarComponentProps {
  active: boolean;
}

export function SidebarComponent({
  active,
  route,
  header,
  onSwitch,
  children,
}: ISidebarComponentProps & {
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
          onSwitch={(value) => props.switchRoute(value)}
          header={
            <>
              <Icon icon="git-repo" size={ICON_SIZE} /> Browser Session
            </>
          }
        >
          <BrowserSession
            active={props.route === ManagerViewRoute.Session}
            savedChromeSessionCollection={
              getAllChromeSessionData().savedChromeSessionCollection
            }
          />
        </SidebarComponent>
        <SidebarComponent
          active={props.route === ManagerViewRoute.Opened}
          route={ManagerViewRoute.Opened}
          onSwitch={(value) => props.switchRoute(value)}
          header={
            <>
              <Icon icon="panel-table" size={ICON_SIZE} /> Live Tabverses
            </>
          }
        >
          <LiveTabSpace
            active={props.route === ManagerViewRoute.Opened}
            tabSpace={getTabSpaceData().tabSpace}
            // tabSpaceRegistry={getTabSpaceData().tabSpaceRegistry}
            tabSpaceRegistry={getTabSpaceRegistry()}
          />
        </SidebarComponent>
        <SidebarComponent
          active={props.route === ManagerViewRoute.Saved}
          route={ManagerViewRoute.Saved}
          onSwitch={(value) => props.switchRoute(value)}
          header={
            <>
              <Icon icon="git-repo" size={ICON_SIZE} /> Saved Tabverses
            </>
          }
        >
          <SavedTabSpace
            active={props.route === ManagerViewRoute.Opened}
            tabSpace={getTabSpaceData().tabSpace}
            tabSpaceRegistry={getTabSpaceRegistry()}
            savedTabSpaceStore={getTabSpaceData().savedTabSpaceStore}
            savedTabSpaceCollection={getTabSpaceData().savedTabSpaceCollection}
          />
        </SidebarComponent>
        <BottomNav />
      </div>
    </>
  );
};
