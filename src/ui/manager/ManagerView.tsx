import '../common/reactdev';
import './manager.scss';

import * as React from 'react';

import { getTabSpaceData } from '../../data/tabSpace/bootstrap';
import { useEffect, useMemo, useState } from 'react';

import { ErrorBoundary } from '../common/ErrorBoundary';
import { SavedTabSpace } from './SavedTabSpace/SavedTabSpace';
import { SessionBrowser } from './BrowserSession/SessionBrowser';
import { Sidebar } from './Sidebar/Sidebar';
import { SidebarContainer } from '../common/SidebarContainer';
import { TabSpaceView } from './TabSpace/TabSpaceView';
import { getAllBookmarkData } from '../../data/bookmark/bootstrap';
import { getAllChromeSessionData } from '../../data/chromeSession/bootstrap';
import {
  addTabSpace as tabSpaceRegistryAddTabSpace,
  getTabSpaceRegistry,
} from '../../tabSpaceRegistry';

export interface IManagerQueryParams {
  op: string;
  stsid?: string;
  route?: string;
}

interface IManagerContainerProps {
  queryParams?: IManagerQueryParams;
}

export enum ManagerViewRoute {
  New = 'new',
  Session = 'session',
  Opened = 'live',
  Saved = 'saved',
}

export const ManagerView = (props: IManagerContainerProps) => {
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

  useEffect(() => {
    // after we history.pushState, chrome will issue chrome.tabs.onRemove and
    // it will be captured by current leader so that current tabspace will be
    // deleted from tabSpaceRegistry. Below we manually issue an message to
    // add it back.
    tabSpaceRegistryAddTabSpace(getTabSpaceData().tabSpace.toTabSpaceStub());
  }, [currentRoute]);

  const renderView = (route: ManagerViewRoute) => {
    switch (route) {
      case ManagerViewRoute.Opened:
        return (
          <TabSpaceView
            tabSpace={getTabSpaceData().tabSpace}
            tabSpaceRegistry={getTabSpaceRegistry()}
            tabPreview={getTabSpaceData().tabPreview}
            savedTabSpaceStore={getTabSpaceData().savedTabSpaceStore}
            allBookmark={getAllBookmarkData().allBookmark}
          />
        );
      case ManagerViewRoute.Saved:
        return (
          <SavedTabSpace
            tabSpace={getTabSpaceData().tabSpace}
            tabSpaceRegistry={getTabSpaceRegistry()}
            savedTabSpaceStore={getTabSpaceData().savedTabSpaceStore}
            savedTabSpaceCollection={getTabSpaceData().savedTabSpaceCollection}
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
          queryParams={props.queryParams}
        />
        {renderView(currentRoute)}
      </SidebarContainer>
    </ErrorBoundary>
  );
};
