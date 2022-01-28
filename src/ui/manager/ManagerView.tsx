import '../common/reactdev';
import './manager.scss';

import * as React from 'react';

import { ErrorBoundary } from '../common/ErrorBoundary';
import { ITabSpaceData } from '../../data/tabSpace/bootstrap';
import { SavedTabSpace } from './SavedTabSpace/SavedTabSpace';
import { SessionBrowser } from './BrowserSession/SessionBrowser';
import { Sidebar } from './Sidebar/Sidebar';
import { SidebarContainer } from '../common/SidebarContainer';
import { TabSpaceView } from './TabSpace/TabSpaceView';
import { getAllBookmarkData } from '../../data/bookmark/bootstrap';
import { getAllChromeSessionData } from '../../data/chromeSession/bootstrap';
import { useMemo, useState } from 'react';

export interface IManagerQueryParams {
  op: string;
  stsid?: string;
  route?: string;
}

interface IManagerContainerProps {
  queryParams?: IManagerQueryParams;
  tabSpaceData: ITabSpaceData;
}

export enum ManagerViewRoute {
  New = 'new',
  Session = 'session',
  Opened = 'live',
  Saved = 'saved',
}

export const ManagerView = (props: IManagerContainerProps) => {
  const allBookmarkData = getAllBookmarkData();
  const [currentRoute, setCurrentRoute] = useState<ManagerViewRoute>(() => {
    const v = (props.queryParams?.route ?? '') as ManagerViewRoute;
    return Object.values(ManagerViewRoute).includes(v)
      ? v
      : ManagerViewRoute.Opened;
  });

  const setRouteAndPushHistoryState = useMemo(() => {
    return (value: ManagerViewRoute) => {
      // @ts-ignore
      const url = new URL(window.location);
      url.searchParams.set('route', value);
      window.history.pushState({}, '', url);
      setCurrentRoute(value);
    };
  }, []);

  const renderView = (route: ManagerViewRoute) => {
    switch (route) {
      case ManagerViewRoute.Opened:
        return (
          <TabSpaceView
            tabSpace={props.tabSpaceData.tabSpace}
            tabSpaceRegistry={props.tabSpaceData.tabSpaceRegistry}
            tabPreview={props.tabSpaceData.tabPreview}
            savedTabSpaceStore={props.tabSpaceData.savedTabSpaceStore}
            allBookmark={allBookmarkData.allBookmark}
          />
        );
      case ManagerViewRoute.Saved:
        return (
          <SavedTabSpace
            tabSpace={props.tabSpaceData.tabSpace}
            tabSpaceRegistry={props.tabSpaceData.tabSpaceRegistry}
            savedTabSpaceStore={props.tabSpaceData.savedTabSpaceStore}
            savedTabSpaceCollection={props.tabSpaceData.savedTabSpaceCollection}
          />
        );
      case ManagerViewRoute.Session:
        return (
          <SessionBrowser
            savedChromeSessionCollection={
              getAllChromeSessionData().savedChromeSessionCollection
            }
          />
        );
    }
  };

  return (
    <ErrorBoundary>
      <SidebarContainer>
        <Sidebar
          route={currentRoute}
          switchRoute={(value) => setRouteAndPushHistoryState(value)}
          tabSpaceData={props.tabSpaceData}
          queryParams={props.queryParams}
        />
        {renderView(currentRoute)}
      </SidebarContainer>
    </ErrorBoundary>
  );
};
