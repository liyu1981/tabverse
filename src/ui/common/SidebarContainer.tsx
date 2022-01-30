import * as React from 'react';

import { slice } from 'lodash';

import classes from './SidebarContainer.module.scss';
import clsx from 'clsx';

export const SidebarContainer = (props) => {
  const sidebarContent = props.children[0];
  const contentChildren = slice(props.children, 1);
  return (
    <div>
      <div className={clsx(classes.sidebarBase, classes.sidebarNormal)}>
        {sidebarContent}
      </div>
      <div className={classes.contentContainerShift}>{contentChildren}</div>
    </div>
  );
};
