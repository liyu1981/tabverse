import '../common/reactdev';

import React, { useMemo, useState } from 'react';

import { ErrorBoundary } from '../common/ErrorBoundary';
import { ManagerViewContextSupport } from './ManagerViewContext';
import { IManagerQueryParams, ManagerViewRoute } from './routes';
import { SavedTabSpaceView } from './SavedTabSpace/SavedTabSpaceView';
import { Sidebar } from './Sidebar/Sidebar';
import { SidebarContainer } from '../common/SidebarContainer';
import { TabSpaceView } from './TabSpace/TabSpaceView';
import { WebtoolView } from './Webtool/WebtoolView';

interface IManagerContainerProps {
  queryParams?: IManagerQueryParams;
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

  const renderView = (route: ManagerViewRoute) => {
    switch (route) {
      case ManagerViewRoute.Opened:
        return <TabSpaceView />;
      case ManagerViewRoute.Saved:
        return <SavedTabSpaceView />;
      case ManagerViewRoute.Webtool:
        return <WebtoolView></WebtoolView>;
      // case ManagerViewRoute.Search:
      //   return <OmniSearch />;
      default:
        return null;
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
