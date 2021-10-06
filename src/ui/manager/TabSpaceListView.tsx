import * as React from 'react';

import { Button, EditableText, Intent } from '@blueprintjs/core';

import { ErrorBoundary } from '../common/ErrorBoundary';
import { SaveIndicator } from './SaveIndicator';
import { TabCard } from './TabCard';
import { TabPreview } from '../../data/tabSpace/tabPreview';
import { TabSpace } from '../../data/tabSpace/tabSpace';
import { getSavedStoreManager } from '../../store/bootstrap';
import { isIdNotSaved } from '../../data/common';
import { observer } from 'mobx-react-lite';
import { saveCurrentTabSpace } from '../../data/tabSpace/tabSpaceStore';
import { updateTabSpaceName } from '../../data/tabSpace/chromeTab';
import { useState } from 'react';

function createStyles(): {
  [k: string]: React.CSSProperties;
} {
  return {
    container: {
      width: '98%',
      marginLeft: '2px',
      marginTop: '20px',
    },
    bottomPlaceholder: {
      minHeight: '80px',
    },
    titleContainer: {
      display: 'flex',
    },
    titleMain: {
      display: 'flex',
      width: '100%',
    },
    titleH1: {
      width: '98%',
      marginLeft: '4px',
    },
    titleButtons: {
      display: 'flex',
      alignItems: 'center',
    },
    toolbarContainer: {
      width: '100%',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '40px',
    },
    toolbarLeftContainer: {
      display: 'flex',
      width: '100%',
    },
    toolbarRightContainer: {
      display: 'flex',
      minWidth: '200px',
      textAlign: 'start',
      direction: 'rtl',
    },
  };
}

interface TabSpaceListViewProps {
  tabSpace: TabSpace;
  tabPreview: TabPreview;
}

export const TabSpaceListView = observer(
  ({ tabSpace, tabPreview }: TabSpaceListViewProps) => {
    const styles = createStyles();
    const [title, setTitle] = useState(tabSpace.name);

    const tabEntries = tabSpace.tabIds.map((tabId) => {
      const tab = tabSpace.findTabById(tabId);
      return tab ? (
        <div key={tab.id}>
          <ErrorBoundary>
            <TabCard
              tab={tab}
              tabPreview={tabPreview.getPreview(tab.chromeTabId)}
              needPreview={true}
            />
          </ErrorBoundary>
        </div>
      ) : (
        <></>
      );
    });

    const tabSpaceTitleView = (
      <div style={styles.titleContainer}>
        <div style={styles.titleMain}>
          <h1 style={styles.titleH1}>
            <EditableText
              className="bp3-editable-text-fullwidth"
              alwaysRenderInput={true}
              maxLength={256}
              value={title}
              selectAllOnFocus={false}
              onChange={(value) => setTitle(value)}
              onConfirm={() => updateTabSpaceName(tabSpace, title)}
            />
          </h1>
        </div>
        <div style={styles.titleButtons}>
          <Button
            text={isIdNotSaved(tabSpace.id) ? 'Save' : 'Auto'}
            title={
              isIdNotSaved(tabSpace.id)
                ? 'Click to save and turn on auto save mode'
                : 'Auto save mode is on.'
            }
            icon="floppy-disk"
            intent={isIdNotSaved(tabSpace.id) ? Intent.PRIMARY : Intent.NONE}
            minimal={isIdNotSaved(tabSpace.id) ? false : true}
            onClick={() => saveCurrentTabSpace()}
          />
        </div>
      </div>
    );

    const tabSpaceToolbarView = (
      <div style={styles.toolbarContainer}>
        <div style={styles.toolbarLeftContainer}></div>
        <div></div>
        <div style={styles.toolbarRightContainer}>
          {tabSpace.needAutoSave() ? (
            <SaveIndicator {...getSavedStoreManager().savedStores} />
          ) : (
            'Auto Saving Off'
          )}
        </div>
      </div>
    );

    return (
      <div style={styles.container}>
        {tabSpaceTitleView}
        {tabSpaceToolbarView}
        <div>{tabEntries}</div>
        <div style={styles.bottomPlaceholder}></div>
      </div>
    );
  },
);
