import * as React from 'react';

import { TabSpaceMsg, sendChromeMessage } from '../../../message';
import { Tag, Tree, TreeNodeInfo } from '@blueprintjs/core';

import { ISidebarComponentProps } from './Sidebar';
import { TabSpace } from '../../../data/tabSpace/TabSpace';
import { TabSpaceRegistry } from '../../../data/tabSpace/TabSpaceRegistry';
import classes from './LiveTabSpace.module.scss';
import { concat } from 'lodash';
import { isIdNotSaved } from '../../../data/common';
import { observer } from 'mobx-react-lite';

export function switchToTab(ts: TabSpace) {
  sendChromeMessage({
    type: TabSpaceMsg.Focus,
    payload: ts.chromeTabId,
  });
  chrome.windows.update(ts.chromeWindowId, { focused: true });
}

export type ILiveTabSpaceProps = ISidebarComponentProps & {
  tabSpace: TabSpace;
  tabSpaceRegistry: TabSpaceRegistry;
};

export const LiveTabSpace = observer(
  ({ tabSpace, tabSpaceRegistry }: ILiveTabSpaceProps) => {
    const onNodeClick = (node, nodePath, e) => {
      if (node.tabSpace) {
        switchToTab(node.tabSpace);
      }
    };

    const thisWindowNodes: TreeNodeInfo[] = [
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

    const otherWindowChildNodes: TreeNodeInfo[] = otherTabSpaces.registry
      .toList()
      .map((ts, index) => {
        return {
          id: index,
          icon: 'panel-table',
          label: <span className={classes.clickable}>{ts.name}</span>,
          secondaryLabel: isIdNotSaved(ts.id) ? '' : <Tag>saved</Tag>,
          tabSpace: ts,
        } as TreeNodeInfo;
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
