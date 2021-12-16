import * as React from 'react';

import { Button, Tree, TreeNodeInfo } from '@blueprintjs/core';
import {
  ChromeSession,
  IChromeSessionSavePayload,
  IChromeWindow,
  NotTabSpaceTabId,
} from '../../data/chromeSession/session';
import { clone, reduce } from 'lodash';
import { restoreTab, restoreWindow } from './util';
import { useEffect, useState } from 'react';

import { ITabSpaceMap } from '../../data/chromeSession/sessionStore';

function createStyles(): { [k: string]: React.CSSProperties } {
  return {
    chromeTabTitle: {
      paddingLeft: '4px',
      wordBreak: 'break-all',
      cursor: 'pointer',
      width: '640px',
    },
  };
}

interface SessionDetailProps {
  session: IChromeSessionSavePayload;
  tabSpaceMap: ITabSpaceMap;
}

export const SessionDetail = ({ session, tabSpaceMap }: SessionDetailProps) => {
  const styles = createStyles();

  const [chromeSession, setChromeSession] = useState<ChromeSession>(null);
  const [expandedMap, setExpandedMap] = useState<{ [k: number]: boolean }>({});

  useEffect(() => {
    if (session) {
      const chromeSession =
        session instanceof ChromeSession
          ? session
          : ChromeSession.fromSavePayload(session);
      setChromeSession(chromeSession);
      setExpandedMap(
        reduce(
          chromeSession.windows.toArray(),
          (result, window) => {
            result[window.windowId] = true;
            return result;
          },
          {},
        ),
      );
    }
  }, [session]);

  const getWindowChildNodes = (window: IChromeWindow): TreeNodeInfo[] => {
    return window.tabIds
      .map((tabId): TreeNodeInfo => {
        const chromeTab = chromeSession.tabs.find((t) => t.tabId === tabId);
        return {
          id: chromeTab.tabId,
          icon: <img src={chromeTab.favIconUrl} width="19" height="19" />,
          label: (
            <div
              style={styles.chromeTabTitle}
              title={chromeTab.url}
              onClick={() => restoreTab(chromeSession, chromeTab.tabId)}
            >
              {chromeTab.title}
            </div>
          ),
        };
      })
      .toArray();
  };

  const contents =
    chromeSession &&
    chromeSession.windows
      .map<TreeNodeInfo>((window) => {
        const tabSpaceName = tabSpaceMap[window.tabSpaceId]?.name ?? 'Unsaved';
        const label =
          window.tabSpaceTabId === NotTabSpaceTabId
            ? `Unmanaged window(${window.windowId})`
            : `Tabverse(${tabSpaceName}) managed window(${window.windowId})`;
        return {
          id: window.windowId,
          icon:
            window.tabSpaceTabId === NotTabSpaceTabId
              ? 'application'
              : 'full-stacked-chart',
          label: <b>{label}</b>,
          secondaryLabel: (
            <span>
              <Button
                minimal={true}
                icon="reset"
                title="restore this window"
                onClick={() => restoreWindow(chromeSession, window.windowId)}
              />
            </span>
          ),
          isExpanded: expandedMap[window.windowId],
          childNodes: getWindowChildNodes(window),
          windowId: window.windowId,
        };
      })
      .toArray();

  return (
    <div>
      <Tree
        contents={contents}
        onNodeCollapse={(node: any) => {
          if (node.windowId) {
            setExpandedMap((lastMap) => {
              const newMap = clone(lastMap);
              newMap[node.windowId] = false;
              return newMap;
            });
          }
        }}
        onNodeExpand={(node: any) => {
          if (node.windowId) {
            setExpandedMap((lastMap) => {
              const newMap = clone(lastMap);
              newMap[node.windowId] = true;
              return newMap;
            });
          }
        }}
      />
    </div>
  );
};
