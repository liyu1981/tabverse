import {
  DisplaySavedSessionGroup,
  deleteSavedSession,
} from '../../../data/chromeSession/sessionStore';
import React, { useEffect, useState } from 'react';

import { ChromeSessionSavePayload } from '../../../data/chromeSession/ChromeSession';
import { LoadStatus } from '../../../global';
import { LoadingSpinner } from '../../common/LoadingSpinner';
import { SessionDetail } from './SessionDetail';
import { SessionSelector } from './SessionSelector';
import SimpleBar from 'simplebar-react';
import classes from './SessionBrowserView.module.scss';
import { useAsyncEffect } from '../../common/useAsyncEffect';
import {
  $savedChromeSessionCollection,
  reloadSavedChromeSessionCollection,
} from '../../../data/chromeSession/store';
import { useStore } from 'effector-react';

function selectFirstSession(savedSessionGroups: DisplaySavedSessionGroup[]) {
  if (
    savedSessionGroups.length >= 1 &&
    savedSessionGroups[0].sessions.length >= 1
  ) {
    return savedSessionGroups[0].sessions[0];
  } else {
    return null;
  }
}

export function SessionBrowserView() {
  const savedChromeSessionCollection = useStore($savedChromeSessionCollection);

  const [selectedSession, setSelectedSession] =
    useState<ChromeSessionSavePayload | null>(() =>
      selectFirstSession(savedChromeSessionCollection.savedSessionGroups),
    );

  useAsyncEffect(async () => {
    await reloadSavedChromeSessionCollection();
  }, []);

  useEffect(() => {
    setSelectedSession(
      selectFirstSession(savedChromeSessionCollection.savedSessionGroups),
    );
  }, [savedChromeSessionCollection.savedSessionGroups]);

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
}
