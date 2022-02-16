import {
  ChromeSession,
  IChromeSessionSavePayload,
  NotTabSpaceTabId,
  isChromeSessionChanged,
} from './ChromeSession';

import { db } from '../../store/db';
import { isJestTest } from '../../debug';
import { logger } from '../../global';
import { scanCurrentTabsForBackground } from './chromeScan';

const MAX_SAVED_SESSIONS = isJestTest() ? 3 : 64;

function countSessionNonTabverseTabs(session: ChromeSession): number {
  // calculate how many real tabs we have, excluding tabverse manager tabs
  let count = session.tabs.size;
  session.windows.forEach((window) => {
    if (window.tabSpaceTabId !== NotTabSpaceTabId) {
      count -= 1;
    }
  });
  return count;
}

// our strategy to delete a session
//   1. start from the last session, if it has at least one session before it
//      with the same tag id (means they are from the same day), delete it.
//   2. otherwise if we can not find a session as above from tags different than
//      current tag (means previous day's sessions), we delete the last session.
function findSessionToDelete(
  lastSavedSessions: IChromeSessionSavePayload[],
  tag: string,
): IChromeSessionSavePayload {
  let toDeleteSession: IChromeSessionSavePayload | null = null;
  let toDeleteSessionGroupSize = 0;

  for (let i = lastSavedSessions.length - 1; i >= 0; i--) {
    if (lastSavedSessions[i].tag === tag) {
      continue;
    }

    if (toDeleteSession === null) {
      toDeleteSession = lastSavedSessions[i];
      toDeleteSessionGroupSize = 1;
      continue;
    }

    if (toDeleteSession.tag === lastSavedSessions[i].tag) {
      toDeleteSessionGroupSize += 1;
    } else {
      if (toDeleteSessionGroupSize === 1) {
        toDeleteSession = lastSavedSessions[i];
        toDeleteSessionGroupSize = 1;
      }
    }
  }

  if (
    toDeleteSession === null ||
    (toDeleteSession !== null && toDeleteSessionGroupSize === 1)
  ) {
    toDeleteSession = lastSavedSessions[lastSavedSessions.length - 1];
  }

  return toDeleteSession;
}

export async function saveSession(
  tag: string,
  sessionCreatedTime: number,
): Promise<IChromeSessionSavePayload | null> {
  const session = new ChromeSession();

  session.tag = tag;
  session.createdAt = sessionCreatedTime;
  session.updatedAt = Date.now();

  await scanCurrentTabsForBackground(session);

  if (session.tabs.size <= 0) {
    // if there is actually no tab (will happen when the browser relaunch
    // between updating itself), skip saving
    return;
  }

  if (countSessionNonTabverseTabs(session) <= 0) {
    // when the session is empty (will happen when the tabverse just loaded by
    // chrome), skip saving
    return;
  }

  logger.log('try to save session:', session);

  const lastSavedSessions = await db
    .table<IChromeSessionSavePayload>(ChromeSession.DB_TABLE_NAME)
    .orderBy('updatedAt')
    .reverse()
    // .filter((savedSession) => savedSession.tag === session.tag)
    .toArray();

  let sessionSavePayload: IChromeSessionSavePayload = null;

  if (lastSavedSessions.length <= 0) {
    sessionSavePayload = session.getSavePayload();
    logger.log('save session as lastSavedSessions.length <= 0');
    await db.table(ChromeSession.DB_TABLE_NAME).add(sessionSavePayload);
    return sessionSavePayload;
  } else {
    const lastSavedSession = lastSavedSessions[0];
    sessionSavePayload = session.getSavePayload();
    if (isChromeSessionChanged(lastSavedSession, sessionSavePayload)) {
      if (lastSavedSessions.length + 1 > MAX_SAVED_SESSIONS) {
        const toDeleteSavedSession = findSessionToDelete(
          lastSavedSessions,
          tag,
        );
        await db
          .table(ChromeSession.DB_TABLE_NAME)
          .delete(toDeleteSavedSession.id);
      }
      logger.log(
        'save session as changed from lastSavedSession',
        JSON.stringify(lastSavedSession),
        JSON.stringify(sessionSavePayload),
      );
      await db.table(ChromeSession.DB_TABLE_NAME).add(sessionSavePayload);
      return sessionSavePayload;
    } else {
      return null;
    }
  }
}
