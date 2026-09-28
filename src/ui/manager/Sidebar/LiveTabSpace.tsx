import React from 'react';
import { TabSpaceStub } from '../../../data/tabSpaceRegistry/TabSpaceRegistry';
import { Tag, Tree, TreeNodeInfo, Tooltip } from '@blueprintjs/core';

import classes from './LiveTabSpace.module.scss';
import { concat } from 'lodash';
import { isIdNotSaved } from '../../../data/common';
import { $serverSyncConfigured } from '../../../data/repo/syncStatus';
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
  // Switching into a tabverse of another window needs a sync server: without
  // one, the only source for that window's tabspace is a manager page that
  // happens to be open there (see src/data/repo/syncStatus.ts).
  const otherWindowsEnabled = useStore($serverSyncConfigured);

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

  const otherTabSpaces = otherWindowsEnabled
    ? tabSpaceRegistry.filter(
        (otherTabSpace) => otherTabSpace.id !== tabSpace.id,
      )
    : tabSpaceRegistry.clear();

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

  const otherWindowNodes: TreeNodeInfo[] = [];
  if (otherWindowsEnabled) {
    otherWindowNodes.push({
      id: 1,
      icon: 'full-stacked-chart',
      isExpanded: otherWindowChildNodes.length > 0,
      label: <b>In Other Windows</b>,
      childNodes: otherWindowChildNodes,
    });
  } else {
    // Disabled on purpose (not hidden): say why, so the feature does not look
    // like it is simply missing.
    otherWindowNodes.push({
      id: 1,
      icon: 'disable',
      isExpanded: true,
      label: (
        <span className={classes.disabled}>
          <b>In Other Windows</b>
          <Tooltip content="Pair this browser with a sync server (refresh button in the bottom bar) to switch between tabverses in different windows.">
            <small>needs a sync server</small>
          </Tooltip>
        </span>
      ),
      childNodes: [],
      disabled: true,
    });
  }

  const nodes = concat(thisWindowNodes, otherWindowNodes);

  return <Tree contents={nodes} onNodeClick={onNodeClick} />;
}
