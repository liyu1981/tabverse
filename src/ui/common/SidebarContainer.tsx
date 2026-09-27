import React from 'react';
import classes from './SidebarContainer.module.scss';

export const SidebarContainer = (props: { children?: React.ReactNode }) => {
  const allChildren = React.Children.toArray(props.children);
  const sidebarContent = allChildren[0];
  const contentChildren = allChildren.slice(1);
  return (
    <div className={classes.topContainer}>
      <div className={classes.leftContainer}>{sidebarContent}</div>
      <div className={classes.rightContainer}>{contentChildren}</div>
    </div>
  );
};
