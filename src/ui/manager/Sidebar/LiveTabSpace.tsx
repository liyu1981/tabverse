import * as React from 'react';

import { Tag, Tree, TreeNodeInfo } from '@blueprintjs/core';

import { ISidebarComponentProps } from './Sidebar';
import { TabSpace } from '../../../data/tabSpace/TabSpace';
import {
  TabSpaceRegistry,
  TabSpaceStub,
} from '../../../data/tabSpace/TabSpaceRegistry';
import classes from './LiveTabSpace.module.scss';
import { concat } from 'lodash';
import { isIdNotSaved } from '../../../data/common';
import { observer } from 'mobx-react-lite';
import { switchToTabSpaceUtil } from '../../../data/tabSpace/chromeUtil';
import { useMemo } from 'react';

export type ILiveTabSpaceProps = ISidebarComponentProps & {
  tabSpace: TabSpace;
  tabSpaceRegistry: TabSpaceRegistry;
};

type TreeNodeInfoWithTabSpace = TreeNodeInfo<{ tabSpaceStub?: TabSpaceStub }>;

export const LiveTabSpace = observer(
  ({ tabSpace, tabSpaceRegistry }: ILiveTabSpaceProps) => {
    const onNodeClick = useMemo(
      () =>
        (
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
        },
      [],
    );

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

    const otherWindowChildNodes: TreeNodeInfoWithTabSpace[] =
      otherTabSpaces.registry
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
  },
);
