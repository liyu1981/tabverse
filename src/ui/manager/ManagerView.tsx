import '../common/reactdev';
import './manager.scss';

import * as React from 'react';

import { BottomNav } from './BottomNav';
import { CreateNewTabverseMenu } from './CreateNewTabverseMenu';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { ITabSpaceData } from '../../data/tabSpace/bootstrap';
import { OpenedTabSpaceTree } from './OpenedTabSpaceTree';
import { SavedTabSpaceTree } from './SavedTabSpaceTree';
import { SessionHistoryMenu } from './SessionHistoryMenu';
import { SidebarContainer } from '../common/sidebar';
import { TabSpaceLogo } from '../common/TabSpaceLogo';
import { TabSpaceView } from './TabSpaceView';

export interface ISiderProps {
  collapsed: boolean;
  onCollapse?: () => void;
  children: React.ReactElement | React.ReactElement[];
}

export const Sider = (props: ISiderProps) => {
  return (
    <>
      <div>
        <TabSpaceLogo />
      </div>
      <br />
      <div>{props.children}</div>
    </>
  );
};

interface IManagerQueryParams {
  op: string;
  stsid?: string;
}

interface IManagerContainerProps {
  queryParams?: IManagerQueryParams;
  tabSpaceData: ITabSpaceData;
}

export const ManagerView = (props: IManagerContainerProps) => {
  return (
    <ErrorBoundary>
      <SidebarContainer>
        <Sider collapsed={false}>
          <CreateNewTabverseMenu />
          <SessionHistoryMenu />
          <OpenedTabSpaceTree
            tabSpace={props.tabSpaceData.tabSpace}
            tabSpaceRegistry={props.tabSpaceData.tabSpaceRegistry}
          />
          <SavedTabSpaceTree
            tabSpace={props.tabSpaceData.tabSpace}
            tabSpaceRegistry={props.tabSpaceData.tabSpaceRegistry}
            savedTabSpaceStore={props.tabSpaceData.savedTabSpaceStore}
          />
          <BottomNav />
        </Sider>
        <TabSpaceView
          tabSpace={props.tabSpaceData.tabSpace}
          tabSpaceRegistry={props.tabSpaceData.tabSpaceRegistry}
          tabPreview={props.tabSpaceData.tabPreview}
          savedTabSpaceStore={props.tabSpaceData.savedTabSpaceStore}
        />
      </SidebarContainer>
    </ErrorBoundary>
  );
};
