import * as React from 'react';

import {
  IDisplaySavedSessionGroup,
  deleteSavedSession,
} from '../../../data/chromeSession/sessionStore';

import { Colors } from '@blueprintjs/core';
import { IChromeSessionSavePayload } from '../../../data/chromeSession/ChromeSession';
import { LoadStatus } from '../../../global';
import { SavedChromeSessionCollection } from '../../../data/chromeSession/SavedChromeSessionCollection';
import { SessionDetail } from './SessionDetail';
import { SessionSelector } from './SessionSelector';
import { observer } from 'mobx-react-lite';
import { useAsyncEffect } from '../../common/useAsyncEffect';
import { useState } from 'react';

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
      boxShadow: 'inset 0px 0px 1px 0px #333',
      overflowY: 'auto',
      right: '0px',
      position: 'fixed',
    },
    sessionBrowserLeftContainer: {
      padding: '20px 8px',
      width: 'calc(100% - 350px)',
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

function selectFirstSession(savedSessionGroups: IDisplaySavedSessionGroup[]) {
  if (
    savedSessionGroups.length >= 1 &&
    savedSessionGroups[0].sessions.length >= 1
  ) {
    return savedSessionGroups[0].sessions[0];
  } else {
    return null;
  }
}

export interface SessionBrowserProps {
  savedChromeSessionCollection: SavedChromeSessionCollection;
}

export const SessionBrowser = observer(
  ({ savedChromeSessionCollection }: SessionBrowserProps) => {
    const styles = createStyles();

    const [selectedSession, setSelectedSession] =
      useState<IChromeSessionSavePayload | null>(() =>
        selectFirstSession(savedChromeSessionCollection.savedSessionGroups),
      );

    useAsyncEffect(async () => {
      await savedChromeSessionCollection.load();
      setSelectedSession(
        selectFirstSession(savedChromeSessionCollection.savedSessionGroups),
      );
    }, []);

    const getTabSpaceMap = () => {
      if (
        savedChromeSessionCollection.savedSessionGroups.length <= 0 ||
        selectedSession === null
      ) {
        return {};
      }

      const sessionGroup = savedChromeSessionCollection.savedSessionGroups.find(
        (sessionGroup) =>
          sessionGroup.sessions.findIndex(
            (session) => session.id === selectedSession.id,
          ) >= 0,
      );

      return sessionGroup ? sessionGroup.tabSpaceMap : {};
    };

    const deleteSession = async (sessionId: string) => {
      await deleteSavedSession(sessionId);
    };

    return (
      <div style={styles.sessionBrowserContainer}>
        {savedChromeSessionCollection.savedSessionGroups.length >= 1 ? (
          <>
            <div style={styles.sessionBrowserLeftContainer}>
              <SessionDetail
                session={selectedSession}
                tabSpaceMap={getTabSpaceMap()}
              />
            </div>
            <div style={styles.sessionBrowserRightContainer}>
              <SessionSelector
                sessions={savedChromeSessionCollection.savedSessionGroups}
                selectedSession={selectedSession}
                onDeleteSession={deleteSession}
                onSetSelectedSession={setSelectedSession}
              />
            </div>
          </>
        ) : (
          <></>
        )}
      </div>
    );
  },
);
