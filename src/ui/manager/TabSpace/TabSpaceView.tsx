import React from 'react';
import SimpleBarReact from 'simplebar-react';
import { TabSpaceListView } from './TabSpaceListView';
import { TabSpaceRightSideView } from '../TabSpaceRightSide/TabSpaceRightSideView';
import classes from './TabSpaceView.module.scss';

export function TabSpaceView() {
  return (
    <div className={classes.container}>
      <div className={classes.mainContainer}>
        <SimpleBarReact autoHide={true} style={{ maxHeight: '100vh' }}>
          <TabSpaceListView />
        </SimpleBarReact>
      </div>
      <div className={classes.rightSideContainer}>
        <SimpleBarReact autoHide={true} style={{ maxHeight: '100vh' }}>
          <TabSpaceRightSideView />
        </SimpleBarReact>
      </div>
    </div>
  );
}
