import React from 'react';
import { TabSpaceStub } from '../../../data/tabSpaceRegistry/TabSpaceRegistry';
import { Tag, Tree, TreeNodeInfo } from '@blueprintjs/core';

import classes from './LiveTabSpace.module.scss';
import { concat } from 'lodash';
import { isIdNotSaved } from '../../../data/common';
import { $tabSpace } from '../../../data/tabSpace/store';
import { useStore } from 'effector-react';
import { switchToTabSpaceUtil } from '../../../data/tabSpace/chromeUtil';
import { $tabSpaceRegistryState } from '../../../data/tabSpaceRegistry/store';
import { SidebarComponentProps } from './Sidebar';

type TreeNodeInfoWithTabSpace = TreeNodeInfo<{ tabSpaceStub?: TabSpaceStub }>;

export type LiveTabSpaceProps = SidebarComponentProps;

export function LiveTabSpace(props: LiveTabSpaceProps) {
  const tabSpace = useStore($tabSpace);
  const { tabSpaceRegistry } = useStore($tabSpaceRegistryState);

  const onNodeClick = (
    node: TreeNodeInfoWithTabSpace,
    _nodePath: number[],
    _e: React.MouseEvent<HTMLElement>,
  ) => {
    if (node.nodeData && node.nodeData.tabSpaceStub) {
      switchToTabSpaceUtil(
        node.nodeData.tabSpaceStub.chromeTabId,
        node.nodeData.tabSpaceStub.chromeWindowId,
      );
    }
  };

  const thisWindowNodes: TreeNodeInfoWithTabSpace[] = [
    {
      id: 0,
      icon: 'full-stacked-chart',
      label: <b>In This Window</b>,
      isExpanded: true,
      childNodes: [
        {
          id: 1,
          icon: 'panel-table',
          label: <span>{tabSpace.name}</span>,
          secondaryLabel: isIdNotSaved(tabSpace.id) ? '' : <Tag>saved</Tag>,
        },
      ],
    },
  ];

  const otherTabSpaces = tabSpaceRegistry.filter(
    (otherTabSpace) => otherTabSpace.id !== tabSpace.id,
  );

  const otherWindowChildNodes: TreeNodeInfoWithTabSpace[] = otherTabSpaces
    .toList()
    .map<TreeNodeInfoWithTabSpace>((ts, index) => {
      return {
        id: index,
        icon: 'panel-table',
        label: <span className={classes.clickable}>{ts.name}</span>,
        secondaryLabel: isIdNotSaved(ts.id) ? '' : <Tag>saved</Tag>,
        nodeData: { tabSpaceStub: ts },
      };
    })
    .toArray();

  const otherWindowNodes: TreeNodeInfo[] = [
    {
      id: 1,
      icon: 'full-stacked-chart',
      isExpanded: otherWindowChildNodes.length > 0,
      label: <b>In Other Windows</b>,
      childNodes: otherWindowChildNodes,
    },
  ];

  const nodes = concat(thisWindowNodes, otherWindowNodes);

  return <Tree contents={nodes} onNodeClick={onNodeClick} />;
}
