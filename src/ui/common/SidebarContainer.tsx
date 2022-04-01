import React from 'react';
import classes from './SidebarContainer.module.scss';
import { slice } from 'lodash';

export const SidebarContainer = (props) => {
  const sidebarContent = props.children[0];
  const contentChildren = slice(props.children, 1);
  return (
    <div className={classes.topContainer}>
      <div className={classes.leftContainer}>{sidebarContent}</div>
      <div className={classes.rightContainer}>{contentChildren}</div>
    </div>
  );
};
