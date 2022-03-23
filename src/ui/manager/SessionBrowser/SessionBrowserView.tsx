import {
  IDisplaySavedSessionGroup,
  deleteSavedSession,
} from '../../../data/chromeSession/sessionStore';
import React, { useState } from 'react';

import { IChromeSessionSavePayload } from '../../../data/chromeSession/ChromeSession';
import { LoadStatus } from '../../../global';
import { LoadingSpinner } from '../../common/LoadingSpinner';
import { SavedChromeSessionCollection } from '../../../data/chromeSession/SavedChromeSessionCollection';
import { SessionDetail } from './SessionDetail';
import { SessionSelector } from './SessionSelector';
import SimpleBar from 'simplebar-react';
import classes from './SessionBrowserView.module.scss';
import { observer } from 'mobx-react-lite';
import { useAsyncEffect } from '../../common/useAsyncEffect';

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

export interface SessionBrowserViewProps {
  savedChromeSessionCollection: SavedChromeSessionCollection;
}

export const SessionBrowserView = observer(
  ({ savedChromeSessionCollection }: SessionBrowserViewProps) => {
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
      <div>
        {savedChromeSessionCollection.loadStatus === LoadStatus.Loading ? (
          <div className={classes.loadingContainer}>
            <LoadingSpinner />
          </div>
        ) : null}
        <div className={classes.sessionBrowserContainer}>
          {savedChromeSessionCollection.savedSessionGroups.length >= 1 ? (
            <>
              <div className={classes.sessionBrowserLeftContainer}>
                <SimpleBar style={{ height: '100vh' }}>
                  <SessionDetail
                    session={selectedSession}
                    tabSpaceMap={getTabSpaceMap()}
                  />
                </SimpleBar>
              </div>
              <div className={classes.sessionBrowserRightContainer}>
                <SessionSelector
                  sessions={savedChromeSessionCollection.savedSessionGroups}
                  selectedSession={selectedSession}
                  onDeleteSession={deleteSession}
                  onSetSelectedSession={setSelectedSession}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>
    );
  },
);