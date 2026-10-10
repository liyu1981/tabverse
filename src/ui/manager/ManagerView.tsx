import '../common/reactdev';

import React, { useMemo, useState } from 'react';

import { ErrorBoundary } from '../common/ErrorBoundary';
import { ManagerViewContextSupport } from './ManagerViewContext';
import { IManagerQueryParams, ManagerViewRoute } from './routes';
import { RightSidePanel } from './RightSidePanel/RightSidePanel';
import { SavedTabSpaceView } from './SavedTabSpace/SavedTabSpaceView';
import { Sidebar } from './Sidebar/Sidebar';
import { SidebarContainer } from '../common/SidebarContainer';
import { TabSpaceView } from './TabSpace/TabSpaceView';
import { WebtoolView } from './Webtool/WebtoolView';
import classes from './ManagerView.module.scss';

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
      <div className={classes.shell}>
        <div className={classes.content}>
          <SidebarContainer>
            <Sidebar
              route={currentRoute}
              switchRoute={(value) => setRouteAndPushHistoryState(value)}
              queryParams={props.queryParams}
            />
            {renderView(currentRoute)}
          </SidebarContainer>
        </div>
        {/* The right panel hosts the server console and the AI history: the
            things that are about the tooling around a tabverse rather than
            about the tabverse. Opening it pushes the view left (adr/0025). */}
        <RightSidePanel />
      </div>
      <ManagerViewContextSupport />
    </ErrorBoundary>
  );
};
