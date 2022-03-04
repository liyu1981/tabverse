import { AllBookmark } from '../../../data/bookmark/Bookmark';
import React from 'react';
import { SavedTabSpaceStore } from '../../../data/tabSpace/SavedTabSpaceStore';
import SimpleBarReact from 'simplebar-react';
import { TabPreview } from '../../../data/tabSpace/TabPreview';
import { TabSpace } from '../../../data/tabSpace/TabSpace';
import { TabSpaceListView } from './TabSpaceListView';
import { TabSpaceRegistry } from '../../../tabSpaceRegistry/TabSpaceRegistry';
import { TabSpaceRightSideView } from '../TabSpaceRightSide/TabSpaceRightSideView';
import classes from './TabSpaceView.module.scss';
import { observer } from 'mobx-react-lite';

interface ITabSpaceViewProps {
  tabSpace: TabSpace;
  tabSpaceRegistry: TabSpaceRegistry;
  tabPreview: TabPreview;
  savedTabSpaceStore: SavedTabSpaceStore;
  allBookmark: AllBookmark;
}

export const TabSpaceView = observer(
  ({ tabSpace, tabPreview, allBookmark }: ITabSpaceViewProps) => {
    return (
      <div className={classes.container}>
        <div className={classes.mainContainer}>
          <SimpleBarReact autoHide={true} style={{ maxHeight: '100vh' }}>
            <TabSpaceListView
              tabSpace={tabSpace}
              tabPreview={tabPreview}
              allBookmark={allBookmark}
            />
          </SimpleBarReact>
        </div>
        <div className={classes.rightSideContainer}>
          <SimpleBarReact autoHide={true} style={{ maxHeight: '100vh' }}>
            <TabSpaceRightSideView tabSpace={tabSpace} />
          </SimpleBarReact>
        </div>
      </div>
    );
  },
);
