import * as Moment from 'moment';
import * as React from 'react';

import {
  Alignment,
  Button,
  ButtonGroup,
  Colors,
  Dialog,
} from '@blueprintjs/core';
import {
  SavedTabSpaceStore,
  deleteSavedTabSpace,
} from '../../data/tabSpace/SavedTabSpaceStore';

import { TabCard } from './TabSpaceView/TabCard';
import { TabSpace } from '../../data/tabSpace/TabSpace';
import { logger } from '../../global';
import { observer } from 'mobx-react-lite';

function createStyles(): { [k: string]: React.CSSProperties } {
  return {
    dialog: {
      minWidth: '800px',
    },
    container: {
      display: 'flex',
      width: '100%',
      maxHeight: '900px',
      overflowY: 'hidden',
    },
    entryContainer: {
      padding: '8px',
      minHeight: '600px',
      maxHeight: '900px',
      overflowY: 'hidden',
    },
    buttonGroupContainer: {
      marginTop: '0px',
      marginBottom: '20px',
      marginRight: '20px',
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

interface ITabEntriesProps {
  tabSpace: TabSpace;
  savedTabSpaceStore: SavedTabSpaceStore;
  restoreFunc: any;
  closeDialogFunc: any;
  loadToCurrentWindowFunc: any;
}

const TabEntries = observer((props: ITabEntriesProps) => {
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
      props.closeDialogFunc();
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
              props.closeDialogFunc();
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
});

interface ISavedTabSpacePreviewDialogProps {
  tabSpace?: TabSpace;
  savedTabSpaceStore: SavedTabSpaceStore;
  isOpen: boolean;
  restoreFunc: any;
  closeFunc: any;
  loadToCurrentWindowFunc: any;
}

export const SavedTabSpacePreviewDialog = observer(
  (props: ISavedTabSpacePreviewDialogProps) => {
    const styles = createStyles();

    return (
      <Dialog
        hasBackdrop={false}
        icon="git-repo"
        isOpen={props.isOpen}
        onClose={props.closeFunc}
        canOutsideClickClose={true}
        title={`Saved TabSpace: ${props.tabSpace?.name ?? ''}`}
        style={styles.dialog}
      >
        <div style={styles.entryContainer}>
          {props.tabSpace ? (
            <TabEntries
              tabSpace={props.tabSpace}
              savedTabSpaceStore={props.savedTabSpaceStore}
              restoreFunc={props.restoreFunc}
              closeDialogFunc={props.closeFunc}
              loadToCurrentWindowFunc={props.loadToCurrentWindowFunc}
            />
          ) : (
            <></>
          )}
        </div>
      </Dialog>
    );
  },
);
