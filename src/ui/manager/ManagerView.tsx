import '../common/reactdev';
import './manager.scss';

import React, { useEffect, useMemo, useState } from 'react';
import { addTabSpace as tabSpaceRegistryAddTabSpace } from '../../data/tabSpaceRegistry';

import { ErrorBoundary } from '../common/ErrorBoundary';
import { ManagerViewContextSupport } from './ManagerViewContext';
import { SavedTabSpaceView } from './SavedTabSpace/SavedTabSpaceView';
import { SessionBrowserView } from './SessionBrowser/SessionBrowserView';
import { Sidebar } from './Sidebar/Sidebar';
import { SidebarContainer } from '../common/SidebarContainer';
import { TabSpaceView } from './TabSpace/TabSpaceView';
import { WebtoolView } from './Webtool/WebtoolView';
import { toTabSpaceStub } from '../../data/tabSpace/TabSpace';
import { $tabSpace } from '../../data/tabSpace/store';

export interface IManagerQueryParams {
  op: string;
  stsid?: string;
  route?: string;
}

interface IManagerContainerProps {
  queryParams?: IManagerQueryParams;
}

export enum ManagerViewRoute {
  Session = 'session',
  Opened = 'live',
  Saved = 'saved',
  Search = 'search',
  Webtool = 'webtool',
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
    tabSpaceRegistryAddTabSpace(toTabSpaceStub($tabSpace.getState()));
  }, [currentRoute]);

  const renderView = (route: ManagerViewRoute) => {
    switch (route) {
      case ManagerViewRoute.Opened:
        return <TabSpaceView />;
      case ManagerViewRoute.Saved:
        return <SavedTabSpaceView />;
      case ManagerViewRoute.Session:
        return <SessionBrowserView />;
      case ManagerViewRoute.Webtool:
        return <WebtoolView></WebtoolView>;
      // case ManagerViewRoute.Search:
      //   return <OmniSearch />;
    }
  };

  return (
    <ErrorBoundary>
      <div>
        <SidebarContainer>
          <Sidebar
            route={currentRoute}
            switchRoute={(value) => setRouteAndPushHistoryState(value)}
            queryParams={props.queryParams}
          />
          {renderView(currentRoute)}
        </SidebarContainer>
        <ManagerViewContextSupport />
      </div>
    </ErrorBoundary>
  );
};
