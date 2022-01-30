import * as React from 'react';

import { IManagerQueryParams, ManagerViewRoute } from '../ManagerView';

import { BottomNav } from '../BottomNav/BottomNav';
import { BrowserSession } from './BrowserSession';
import { ErrorBoundary } from '../../common/ErrorBoundary';
import { ITabSpaceData } from '../../../data/tabSpace/bootstrap';
import { Icon } from '@blueprintjs/core';
import { LiveTabSpace } from './LiveTabSpace';
import { SavedTabSpace } from './SavedTabSpace';
import { TabSpaceLogo } from '../../common/TabSpaceLogo';
import classes from './Sidebar.module.scss';
import clsx from 'clsx';
import { getAllChromeSessionData } from '../../../data/chromeSession/bootstrap';

enum Route {
  New = 'new',
  Session = 'session',
  Opened = 'live',
  Saved = 'saved',
}

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
  route: Route;
  header: JSX.Element | React.ReactFragment;
  onSwitch: (value) => void;
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
  tabSpaceData: ITabSpaceData;
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
        <SidebarComponent
          active={props.route === ManagerViewRoute.Session}
          route={Route.Session}
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
          route={Route.Opened}
          onSwitch={(value) => props.switchRoute(value)}
          header={
            <>
              <Icon icon="panel-table" size={ICON_SIZE} /> Live Tabverses
            </>
          }
        >
          <LiveTabSpace
            active={props.route === ManagerViewRoute.Opened}
            tabSpace={props.tabSpaceData.tabSpace}
            tabSpaceRegistry={props.tabSpaceData.tabSpaceRegistry}
          />
        </SidebarComponent>
        <SidebarComponent
          active={props.route === ManagerViewRoute.Saved}
          route={Route.Saved}
          onSwitch={(value) => props.switchRoute(value)}
          header={
            <>
              <Icon icon="git-repo" size={ICON_SIZE} /> Saved Tabverses
            </>
          }
        >
          <SavedTabSpace
            active={props.route === ManagerViewRoute.Opened}
            tabSpace={props.tabSpaceData.tabSpace}
            tabSpaceRegistry={props.tabSpaceData.tabSpaceRegistry}
            savedTabSpaceStore={props.tabSpaceData.savedTabSpaceStore}
            savedTabSpaceCollection={props.tabSpaceData.savedTabSpaceCollection}
          />
        </SidebarComponent>
        <BottomNav />
      </div>
    </>
  );
};
