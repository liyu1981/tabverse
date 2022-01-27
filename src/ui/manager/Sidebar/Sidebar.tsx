import * as React from 'react';

import { IManagerQueryParams, ManagerViewRoute } from '../ManagerView';

import { BottomNav } from '../BottomNav';
import { BrowserSession } from './BrowserSession';
import { ErrorBoundary } from '../../common/ErrorBoundary';
import { ITabSpaceData } from '../../../data/tabSpace/bootstrap';
import { Icon } from '@blueprintjs/core';
import { LiveTabSpace } from './LiveTabSpace';
import { SavedTabSpace } from './SavedTabSpace';
import { TabSpaceLogo } from '../../common/TabSpaceLogo';
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

export function createSidebarComponentStyles(): {
  [k: string]: React.CSSProperties;
} {
  return {
    container: {
      backgroundColor: 'white',
      borderRadius: '3px',
      marginBottom: '18px',
      padding: '3px',
      boxShadow: '0px 0px 5px -1px #333',
    },
    sectionHeadContainer: {
      lineHeight: '42px',
      paddingLeft: '10px',
      fontSize: '1.2em',
      backgroundColor: '#fafafa',
      fontWeight: 'bold',
    },
  };
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
  const styles = createSidebarComponentStyles();

  return (
    <ErrorBoundary>
      <div
        className={clsx(
          'tabverse-sidebar-component',
          active
            ? 'tabverse-sidebar-component-active'
            : 'tabverse-sidebar-component-inactive',
        )}
        style={styles.container}
      >
        <div className="tabverse-sidebar-component-edge"> </div>
        <div
          className={'tabverse-sidebar-component-header'}
          style={styles.sectionHeadContainer}
          onClick={() => onSwitch(route)}
        >
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
          />
        </SidebarComponent>
        <BottomNav />
      </div>
    </>
  );
};
