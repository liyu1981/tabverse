import React from 'react';
import { Tag, Tree, TreeNodeInfo } from '@blueprintjs/core';

import classes from './LiveTabSpace.module.scss';
import { isIdNotSaved } from '../../../data/common';
import { $tabSpace } from '../../../data/tabSpace/store';
import { useStore } from 'effector-react';
import type { SidebarComponentProps } from './Sidebar';

export type LiveTabSpaceProps = SidebarComponentProps;

/**
 * The tabverse of the window this manager page was opened in.
 *
 * There is deliberately no "other windows" section any more: a manager page
 * owns exactly one window and never switches to a tabverse that lives in
 * another one (ADR 0006). Cross-window presence used to be tracked by the
 * tabSpaceRegistry's leader election, which is gone with it.
 */
export function LiveTabSpace(props: LiveTabSpaceProps) {
  const tabSpace = useStore($tabSpace);

  const nodes: TreeNodeInfo[] = [
    {
      id: 0,
      icon: 'panel-table',
      isExpanded: true,
      label: (
        <span className={classes.currentWindow}>
          <b>In This Window</b> <span>{tabSpace.name}</span>
          {isIdNotSaved(tabSpace.id) ? '' : <Tag>saved</Tag>}
        </span>
      ),
    },
  ];

  return <Tree contents={nodes} />;
}
