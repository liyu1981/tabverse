import * as React from 'react';

import { AllBookmark } from '../../data/bookmark/bookmark';
import { ResizableSplitView } from '../common/ResizableSplitView';
import { SavedTabSpaceStore } from '../../data/tabSpace/tabSpaceStore';
import { TabPreview } from '../../data/tabSpace/tabPreview';
import { TabSpace } from '../../data/tabSpace/tabSpace';
import { TabSpaceListView } from './TabSpaceListView';
import { TabSpaceRegistry } from '../../data/tabSpace/tabSpaceRegistry';
import { TabSpaceRightSideView } from './TabSpaceRightSideView';
import { getAllBookmarkData } from '../../data/bookmark/bootstrap';
import { observer } from 'mobx-react-lite';

function createStyles(): {
  [k: string]: React.CSSProperties;
} {
  return {
    container: {
      width: '98%',
      marginLeft: '2px',
      marginTop: '20px',
    },
    leftSideContainer: {
      height: '100vh',
      overflowY: 'auto',
    },
    rightSideContainer: {
      maxWidth: '50%',
      overflowY: 'auto',
    },
  };
}

interface ITabSpaceViewProps {
  tabSpace: TabSpace;
  tabSpaceRegistry: TabSpaceRegistry;
  tabPreview: TabPreview;
  savedTabSpaceStore: SavedTabSpaceStore;
  allBookmark: AllBookmark;
}

export const TabSpaceView = observer(
  ({ tabSpace, tabPreview, allBookmark }: ITabSpaceViewProps) => {
    const styles = createStyles();

    return (
      <ResizableSplitView
        firstView={
          <TabSpaceListView
            tabSpace={tabSpace}
            tabPreview={tabPreview}
            allBookmark={allBookmark}
          />
        }
        secondView={
          <div style={styles.container}>
            <TabSpaceRightSideView tabSpace={tabSpace} />
          </div>
        }
        firstViewStyles={styles.leftSideContainer}
        secondViewStyles={styles.rightSideContainer}
      />
    );
  },
);
