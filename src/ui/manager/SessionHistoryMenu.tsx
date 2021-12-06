import * as Moment from 'moment';
import * as React from 'react';

import {
  Button,
  Colors,
  Drawer,
  Menu,
  MenuItem,
  Tree,
  TreeNodeInfo,
} from '@blueprintjs/core';
import {
  ChromeSession,
  IChromeSessionSavePayload,
  IChromeWindow,
  NotTabSpaceTabId,
} from '../../data/chromeSession/session';
import {
  IDisplaySavedSessionGroup,
  ITabSpaceMap,
  deleteSavedSession,
  loadSavedSessionsForDisplay,
} from '../../data/chromeSession/sessionStore';
import { clone, concat, merge, reduce } from 'lodash';
import { useEffect, useState } from 'react';

import { LoadStatus } from '../../global';
import { createStyles as createStylesFromNewTabverseMenu } from './CreateNewTabverseMenu';
import { flatten } from 'lodash';

async function createNewChromeWindowWithTab(
  tabCreateFn: (chromeWindow: chrome.windows.Window) => Promise<any>[],
): Promise<chrome.windows.Window> {
  const chromeWindow = await chrome.windows.create({ focused: true });
  const existingTabs = await chrome.tabs.query({ windowId: chromeWindow.id });
  const allPromises = concat([], tabCreateFn(chromeWindow));
  existingTabs.forEach((tab) => allPromises.push(chrome.tabs.remove(tab.id)));
  await Promise.all(allPromises);
  return chromeWindow;
}

async function restoreWindow(session: ChromeSession, windowId: number) {
  const window = session.windows.find((window) => window.windowId === windowId);
  if (window) {
    const tabs = session.tabs.filter((tab) => {
      return window.tabIds.findIndex((tabId) => tabId === tab.tabId) >= 0;
    });
    const chromeWindow = await createNewChromeWindowWithTab(
      (theChromeWindow) => {
        const allPromises = [];
        for (let i = 0; i < tabs.size; i++) {
          const tab = tabs.get(i);
          const p = chrome.tabs.create({
            windowId: theChromeWindow.id,
            url: tab.url,
          });
          allPromises.push(p);
        }
        return allPromises;
      },
    );
    await chrome.tabs.create({
      windowId: chromeWindow.id,
      url: 'manager.html?op=new',
    });
  }
}

async function restoreTab(session: ChromeSession, tabId: number) {
  const tab = session.tabs.find((tab) => tab.tabId === tabId);
  if (tab) {
    createNewChromeWindowWithTab((theChromeWindow) => {
      return [
        chrome.tabs.create({ windowId: theChromeWindow.id, url: tab.url }),
      ];
    });
  }
}

function createStyles(): { [k: string]: React.CSSProperties } {
  return merge(createStylesFromNewTabverseMenu(), {
    sessionBrowserContainer: {
      display: 'flex',
    },
    sessionBrowserRightContainer: {
      minWidth: '350px',
      height: '100vh',
      padding: '18px',
      backgroundColor: Colors.LIGHT_GRAY3,
      boxShadow: 'inset 0px -3px 1px 0px #333',
      overflowY: 'auto',
    },
    sessionBrowserLeftContainer: {
      padding: '20px 8px',
      width: '100%',
      height: '100vh',
    },
    chromeTabContainer: {
      display: 'flex',
      minHeight: '36px',
    },
    chromeTabInfoContainer: {
      width: '100%',
    },
    chromeTabTitle: {
      paddingLeft: '4px',
      wordBreak: 'break-all',
      cursor: 'pointer',
      width: '640px',
    },
    chromeTabUrl: {
      wordBreak: 'break-all',
    },
    sessionLabelActive: {
      borderLeft: `solid ${Colors.GRAY1}`,
    },
    sessionLabelContainer: {
      paddingLeft: '8px',
    },
    sessionLabelSub: {
      marginTop: '-10px',
      color: Colors.GRAY3,
    },
    sessionLabelContentContainer: {
      display: 'flex',
      alignItems: 'center',
    },
    sessionLabelContent: {
      width: '100%',
    },
    sessionLabelTools: {
      minWidth: '20px',
    },
  });
}

const SessionLabel = ({
  session,
  selected,
  onDelete,
}: {
  session: ChromeSession | IChromeSessionSavePayload;
  selected?: boolean;
  onDelete?: (sessionId: string) => void;
}) => {
  const styles = createStyles();
  return (
    <div
      style={merge(
        styles.sessionLabelContainer,
        selected ? styles.sessionLabelActive : null,
      )}
    >
      <div style={styles.sessionLabelContentContainer}>
        <div style={styles.sessionLabelContent}>
          <div>
            <span title={session.id}>Session</span>
          </div>
          <div style={styles.sessionLabelSub}>
            <sub>Created at {Moment(session.createdAt).calendar()}</sub>
          </div>
          <div style={styles.sessionLabelSub}>
            <sub>Saved at {Moment(session.updatedAt).calendar()}</sub>
          </div>
        </div>
        <div style={styles.sessionLabelTools}>
          <Button
            minimal={true}
            icon="trash"
            onClick={() => onDelete && onDelete(session.id)}
          />
        </div>
      </div>
    </div>
  );
};

const SessionBrowser = ({
  session,
  tabSpaceMap,
}: {
  session: IChromeSessionSavePayload;
  tabSpaceMap: ITabSpaceMap;
}) => {
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

export const SessionHistoryMenu = () => {
  const styles = createStyles();

  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<IDisplaySavedSessionGroup[]>([]);
  const [selectedSession, setSelectedSession] =
    useState<IChromeSessionSavePayload>(null);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>(LoadStatus.Idle);

  const loadData = async () => {
    setLoadStatus(LoadStatus.Loading);
    const savedSessionGroups = await loadSavedSessionsForDisplay();
    setSessions(savedSessionGroups);
    if (
      savedSessionGroups.length >= 1 &&
      savedSessionGroups[0].sessions.length >= 1
    ) {
      setSelectedSession(savedSessionGroups[0].sessions[0]);
    }
    setLoadStatus(LoadStatus.Done);
  };

  const offloadData = async () => {
    setLoadStatus(LoadStatus.Idle);
    setSessions([]);
    setSelectedSession(null);
  };

  const deleteSession = async (sessionId: string) => {
    await deleteSavedSession(sessionId);
    await loadData();
  };

  const renderSessionSelector = () => {
    const savedSessionMenus = sessions.map((sessionGroup) => {
      return sessionGroup.sessions.map((session) => {
        return (
          <MenuItem
            key={session.id}
            text={
              <SessionLabel
                session={session}
                selected={session.id === selectedSession.id}
                onDelete={(sessionId: string) => deleteSession(sessionId)}
              />
            }
            onClick={() => setSelectedSession(session)}
          />
        );
      });
    });

    const sessionSelector =
      savedSessionMenus.length <= 0 ? (
        ''
      ) : (
        <Menu style={{ marginBottom: '40px' }}>
          {flatten(savedSessionMenus)}
        </Menu>
      );
    return sessionSelector;
  };

  const getTabSpaceMap = () => {
    const sessionGroup = sessions.find(
      (sessionGroup) =>
        sessionGroup.sessions.findIndex(
          (session) => session.id === selectedSession.id,
        ) >= 0,
    );
    return sessionGroup ? sessionGroup.tabSpaceMap : {};
  };

  return (
    <div style={styles.singleMenuContainer}>
      <Menu>
        <MenuItem
          icon="history"
          text={<b>Browser Session History</b>}
          onClick={() => setOpen(true)}
        ></MenuItem>
        <Drawer
          icon="history"
          title="Browser Session History"
          isOpen={open}
          position="right"
          onClose={() => setOpen(false)}
          onOpening={() => loadData()}
          onClosed={() => offloadData()}
        >
          {loadStatus === LoadStatus.Idle ? (
            ''
          ) : loadStatus === LoadStatus.Loading ? (
            'loading...'
          ) : (
            <div style={styles.sessionBrowserContainer}>
              <div style={styles.sessionBrowserLeftContainer}>
                <SessionBrowser
                  session={selectedSession}
                  tabSpaceMap={getTabSpaceMap()}
                />
              </div>
              <div style={styles.sessionBrowserRightContainer}>
                {renderSessionSelector()}
              </div>
            </div>
          )}
        </Drawer>
      </Menu>
    </div>
  );
};
