import * as React from 'react';

import {
  IDisplaySavedSessionGroup,
  deleteSavedSession,
  loadSavedSessionsForDisplay,
} from '../../data/chromeSession/sessionStore';
import { useEffect, useState } from 'react';

import { Colors } from '@blueprintjs/core';
import { IChromeSessionSavePayload } from '../../data/chromeSession/session';
import { LoadStatus } from '../../global';
import { SessionDetail } from './SessionDetail';
import { SessionSelector } from './SessionSelector';

function createStyles(): { [k: string]: React.CSSProperties } {
  return {
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
  };
}

export const SessionBrowser = () => {
  const styles = createStyles();

  const [sessions, setSessions] = useState<IDisplaySavedSessionGroup[]>([]);
  const [selectedSession, setSelectedSession] =
    useState<IChromeSessionSavePayload>(null);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>(LoadStatus.Idle);

  const getTabSpaceMap = () => {
    const sessionGroup = sessions.find(
      (sessionGroup) =>
        sessionGroup.sessions.findIndex(
          (session) => session.id === selectedSession.id,
        ) >= 0,
    );
    return sessionGroup ? sessionGroup.tabSpaceMap : {};
  };

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

  const deleteSession = async (sessionId: string) => {
    await deleteSavedSession(sessionId);
    await loadData();
  };

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div style={styles.sessionBrowserContainer}>
      {loadStatus === LoadStatus.Loading ? (
        'loading...'
      ) : (
        <>
          <div style={styles.sessionBrowserLeftContainer}>
            <SessionDetail
              session={selectedSession}
              tabSpaceMap={getTabSpaceMap()}
            />
          </div>
          <div style={styles.sessionBrowserRightContainer}>
            <SessionSelector
              sessions={sessions}
              selectedSession={selectedSession}
              onDeleteSession={deleteSession}
              onSetSelectedSession={setSelectedSession}
            />
          </div>
        </>
      )}
    </div>
  );
};
