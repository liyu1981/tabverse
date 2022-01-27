import * as Moment from 'moment';
import * as React from 'react';

import { Alignment, Button, ButtonGroup, Colors } from '@blueprintjs/core';
import {
  SavedTabSpaceStore,
  deleteSavedTabSpace,
} from '../../../data/tabSpace/SavedTabSpaceStore';

import { TabCard } from '../TabSpaceView/TabCard';
import { TabSpace } from '../../../data/tabSpace/TabSpace';
import { logger } from '../../../global';
import { observer } from 'mobx-react-lite';

function createStyles(): { [k: string]: React.CSSProperties } {
  return {
    container: {
      display: 'flex',
      width: '100%',
      overflowY: 'hidden',
    },
    entryContainer: {
      padding: '8px',
      minHeight: '600px',
      overflowY: 'hidden',
    },
    buttonGroupContainer: {
      marginTop: '0px',
      marginBottom: '20px',
      marginRight: '20px',
      marginLeft: '3px',
      minWidth: '200px',
      maxWidth: '200px',
      position: 'sticky',
      height: '400px',
    },
    savedTabsContainer: {
      marginTop: '20px',
      width: '100%',
      paddingRight: '20px',
      overflowY: 'auto',
      paddingBottom: '50px',
      paddingLeft: '1px',
    },
    infoContainer: {
      marginLeft: '18px',
      wordBreak: 'break-all',
      marginBottom: '48px',
    },
  };
}

interface ISavedTabSpaceDetailProps {
  tabSpace: TabSpace;
  savedTabSpaceStore: SavedTabSpaceStore;
  restoreFunc: any;
  loadToCurrentWindowFunc: any;
}

export const SavedTabSpaceDetail = observer(
  (props: ISavedTabSpaceDetailProps) => {
    const styles = createStyles();

    const entries: React.ReactElement[] = [];
    props.tabSpace.tabs.forEach((savedTab) => {
      entries.push(
        <div key={savedTab.id}>
          <TabCard key={savedTab.id} tab={savedTab} />
        </div>,
      );
    });

    const deleteTabSpace = (savedTabSpaceId: string) => {
      async function action() {
        logger.log('request to delete:', savedTabSpaceId);
        await deleteSavedTabSpace(savedTabSpaceId);
      }
      action();
    };

    return (
      <div style={styles.container}>
        <div style={styles.buttonGroupContainer}>
          <div style={styles.infoContainer}>
            <h2>{props.tabSpace.name}</h2>
            <div>
              <sub style={{ color: Colors.GRAY3 }}>
                Created {Moment(props.tabSpace.createdAt).fromNow()}
              </sub>
              <br />
              <sub style={{ color: Colors.GRAY3 }}>
                Saved {Moment(props.tabSpace.updatedAt).fromNow()}
              </sub>
            </div>
          </div>
          <ButtonGroup
            large={true}
            vertical={true}
            minimal={true}
            alignText={Alignment.LEFT}
          >
            <Button
              icon="folder-shared"
              onClick={() => {
                props.restoreFunc(props.tabSpace);
              }}
              title="Load all tabs to new window"
            >
              Load to New
            </Button>
            <Button
              icon="folder-open"
              onClick={() => {
                props.loadToCurrentWindowFunc(props.tabSpace.id);
              }}
              title="Load all tabs to current window"
            >
              Load to Current
            </Button>
            {/* <Button icon="archive">Archive</Button> */}
            <Button
              icon="trash"
              onClick={() => deleteTabSpace(props.tabSpace.id)}
            >
              Delete
            </Button>
          </ButtonGroup>
        </div>
        <div style={styles.savedTabsContainer}>
          <p>Saved Tabs({entries.length})</p>
          {entries}
        </div>
      </div>
    );
  },
);
