import * as React from 'react';

import { ResizableSplitView } from '../common/ResizableSplitView';
import { SavedTabSpaceStore } from '../../data/tabSpace/tabSpaceStore';
import { TabPreview } from '../../data/tabSpace/tabPreview';
import { TabSpace } from '../../data/tabSpace/tabSpace';
import { TabSpaceListView } from './TabSpaceListView';
import { TabSpaceRegistry } from '../../data/tabSpace/tabSpaceRegistry';
import { TabSpaceRightSideView } from './TabSpaceRightSideView';
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
}

export const TabSpaceView = observer(
  ({ tabSpace, tabPreview }: ITabSpaceViewProps) => {
    const styles = createStyles();

    const rightSideView = (
      <div style={styles.container}>
        <TabSpaceRightSideView tabSpace={tabSpace} />
      </div>
    );

    return (
      <ResizableSplitView
        firstView={
          <TabSpaceListView tabSpace={tabSpace} tabPreview={tabPreview} />
        }
        secondView={rightSideView}
        firstViewStyles={styles.leftSideContainer}
        secondViewStyles={styles.rightSideContainer}
      />
    );
  },
);
