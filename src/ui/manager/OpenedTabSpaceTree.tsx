import * as React from 'react';

import { TabSpaceMsg, sendChromeMessage } from '../../message';
import { Tree, TreeNodeInfo } from '@blueprintjs/core';

import { ErrorBoundary } from '../common/ErrorBoundary';
import { TabSpace } from '../../data/tabSpace/tabSpace';
import { TabSpaceRegistry } from '../../data/tabSpace/tabSpaceRegistry';
import { concat } from 'lodash';
import { observer } from 'mobx-react-lite';

function switchToTab(ts: TabSpace) {
  sendChromeMessage({
    type: TabSpaceMsg.Focus,
    payload: ts.chromeTabId,
  });
  chrome.windows.update(ts.chromeWindowId, { focused: true });
}

export function createTreeBaseStyles(): {
  [k: string]: React.CSSProperties;
} {
  return {
    container: {
      backgroundColor: 'white',
      borderRadius: '3px',
      marginBottom: '18px',
    },
    clickable: {
      cursor: 'pointer',
    },
    sectionHeadContainer: {
      lineHeight: '42px',
      paddingLeft: '10px',
      fontSize: '1.2em',
      backgroundColor: '#fafafa',
      borderRadius: '3px 3px 0 0',
      boxShadow: '0px 0px 5px -1px #333',
      marginBottom: '8px',
      fontWeight: 'bold',
    },
  };
}

interface IOpenedTabSpaceTreeProps {
  tabSpace: TabSpace;
  tabSpaceRegistry: TabSpaceRegistry;
}

export const OpenedTabSpaceTree = observer(
  ({ tabSpace, tabSpaceRegistry }: IOpenedTabSpaceTreeProps) => {
    const styles = createTreeBaseStyles();

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
            label: tabSpace.name,
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
          label: <span style={styles.clickable}>{ts.name}</span>,
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

    return (
      <ErrorBoundary>
        <div style={styles.container}>
          <div style={styles.sectionHeadContainer}>Live Tabverses</div>
          <Tree contents={nodes} onNodeClick={onNodeClick} />
        </div>
      </ErrorBoundary>
    );
  },
);
