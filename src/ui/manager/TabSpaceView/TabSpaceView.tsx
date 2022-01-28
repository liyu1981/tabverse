import * as React from 'react';

import { AllBookmark } from '../../../data/bookmark/Bookmark';
import { SavedTabSpaceStore } from '../../../data/tabSpace/SavedTabSpaceStore';
import { TabPreview } from '../../../data/tabSpace/TabPreview';
import { TabSpace } from '../../../data/tabSpace/TabSpace';
import { TabSpaceListView } from './TabSpaceListView';
import { TabSpaceRegistry } from '../../../data/tabSpace/TabSpaceRegistry';
import { TabSpaceRightSideView } from './TabSpaceRightSideView';
import { observer } from 'mobx-react-lite';
import classes from './TabSpaceView.module.scss';

interface ITabSpaceViewProps {
  tabSpace: TabSpace;
  tabSpaceRegistry: TabSpaceRegistry;
  tabPreview: TabPreview;
  savedTabSpaceStore: SavedTabSpaceStore;
  allBookmark: AllBookmark;
}

// <div className={classes.leftSideContainer}>

export const TabSpaceView = observer(
  ({ tabSpace, tabPreview, allBookmark }: ITabSpaceViewProps) => {
    return (
      <div className={classes.container}>
        <TabSpaceListView
          tabSpace={tabSpace}
          tabPreview={tabPreview}
          allBookmark={allBookmark}
        />
        <div className={classes.rightSideContainer}>
          <TabSpaceRightSideView tabSpace={tabSpace} />
        </div>
      </div>
    );
  },
);
