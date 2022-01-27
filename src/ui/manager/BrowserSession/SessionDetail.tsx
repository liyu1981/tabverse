import * as React from 'react';

import { Button, Icon, Tree, TreeNodeInfo } from '@blueprintjs/core';
import {
  ChromeSession,
  IChromeSessionSavePayload,
  IChromeWindow,
  NotTabSpaceTabId,
} from '../../../data/chromeSession/ChromeSession';
import { clone, reduce } from 'lodash';
import { restoreTab, restoreWindow } from './util';
import { useEffect, useState } from 'react';

import { ITabSpaceMap } from '../../../data/chromeSession/sessionStore';

function createStyles(): { [k: string]: React.CSSProperties } {
  return {
    sessionTitle: {
      fontSize: '1.2em',
      minHeight: '48px',
      lineHeight: '48px',
      marginLeft: '8px',
      fontWeight: 'bold',
    },
    chromeTabTitle: {
      fontSize: '1.2em',
      paddingLeft: '4px',
      wordBreak: 'break-all',
      cursor: 'pointer',
    },
    domainLabel: {
      color: '#999',
    },
    tabFavIcon: {
      width: '32px',
      height: '32px',
      marginRight: '8px',
    },
  };
}

interface SessionDetailProps {
  session: IChromeSessionSavePayload;
  tabSpaceMap: ITabSpaceMap;
}

function getDomainFromUrl(urlString: string) {
  try {
    const u = new URL(urlString);
    return `${u.protocol}://${u.host}...`;
  } catch (e) {
    return '';
  }
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
          icon: <img style={styles.tabFavIcon} src={chromeTab.favIconUrl} />,
          label: (
            <div
              style={styles.chromeTabTitle}
              title={chromeTab.url}
              onClick={() => restoreTab(chromeSession, chromeTab.tabId)}
            >
              {chromeTab.title}
            </div>
          ),
          secondaryLabel: (
            <span style={styles.domainLabel}>
              {getDomainFromUrl(chromeTab.url)}
            </span>
          ),
          className: 'tabverse-session-tree-node',
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
          icon: (
            <Icon
              icon={
                window.tabSpaceTabId === NotTabSpaceTabId
                  ? 'application'
                  : 'full-stacked-chart'
              }
              size={24}
            />
          ),
          label: <div style={styles.sessionTitle}>{label}</div>,
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
          className: 'tabverse-session-tree-node',
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
