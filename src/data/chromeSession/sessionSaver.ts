import {
  CHROMESESSION_DB_TABLE_NAME,
  ChromeSession,
  ChromeSessionSavePayload,
  NotTabSpaceTabId,
  convertAndGetSavePayload,
  isChromeSessionChanged,
  newEmptyChromeSession,
} from './ChromeSession';

import { db } from '../../storage/db';
import { isJestTest } from '../../debug';
import { logger } from '../../global';
import { scanCurrentTabsForBackground } from './chromeScan';
import { setAttrForObject } from '../common';

const MAX_SAVED_SESSIONS_PER_DAY = isJestTest() ? 2 : 64;
const MAX_SESSION_DAYS = isJestTest() ? 2 : 14;

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
//   1. for each tag (day), keep MAX_SAVED_SESSIONS_PER_DAY
//   2. keep MAX_SESSION_DAYS of days
function findSessionIdsToDelete(
  currentSavedSession: ChromeSessionSavePayload,
  lastSavedSessions: ChromeSessionSavePayload[],
): string[] {
  const toDeleteSessionIds: string[] = [];

  const groups: ChromeSessionSavePayload[][] = [];
  let currentGroup = [currentSavedSession];
  for (let i = 0; i < lastSavedSessions.length; i++) {
    if (lastSavedSessions[i].tag !== currentGroup[0].tag) {
      groups.push(currentGroup);
      currentGroup = [lastSavedSessions[i]];
      continue;
    } else {
      currentGroup.push(lastSavedSessions[i]);
    }
  }
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  for (let i = MAX_SESSION_DAYS; i < groups.length; i++) {
    groups[i].forEach((s) => toDeleteSessionIds.push(s.id));
  }

  for (let i = 0; i < MAX_SESSION_DAYS && i < groups.length; i++) {
    if (groups[i].length >= MAX_SAVED_SESSIONS_PER_DAY) {
      for (let j = MAX_SAVED_SESSIONS_PER_DAY; j < groups[i].length; j++) {
        toDeleteSessionIds.push(groups[i][j].id);
      }
    }
  }

  return toDeleteSessionIds;
}

export async function saveSession(
  tag: string,
  sessionCreatedTime: number,
): Promise<ChromeSessionSavePayload | null> {
  let session = newEmptyChromeSession();

  session = setAttrForObject('tag', tag, session);
  session = setAttrForObject('createdAt', sessionCreatedTime, session);
  session = setAttrForObject('updatedAt', Date.now(), session);

  session = await scanCurrentTabsForBackground(session);

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
    .table<ChromeSessionSavePayload>(CHROMESESSION_DB_TABLE_NAME)
    .orderBy('createdAt')
    .reverse()
    .toArray();

  let sessionSavePayload: ChromeSessionSavePayload = null;

  if (lastSavedSessions.length <= 0) {
    logger.log('save session as lastSavedSessions.length <= 0');
    const r = convertAndGetSavePayload(session);
    session = r.chromeSession;
    sessionSavePayload = r.savePayload;
    await db.table(CHROMESESSION_DB_TABLE_NAME).add(sessionSavePayload);
    return sessionSavePayload;
  } else {
    const lastSavedSession = lastSavedSessions[0];
    const r = convertAndGetSavePayload(session);
    session = r.chromeSession;
    sessionSavePayload = r.savePayload;
    if (isChromeSessionChanged(lastSavedSession, sessionSavePayload)) {
      const toDeleteSavedSessionIds = findSessionIdsToDelete(
        sessionSavePayload,
        lastSavedSessions,
      );
      if (toDeleteSavedSessionIds.length > 0) {
        logger.log('will reap stale sessions', toDeleteSavedSessionIds);
        await db
          .table(CHROMESESSION_DB_TABLE_NAME)
          .bulkDelete(toDeleteSavedSessionIds);
      }
      logger.log(
        'save session as changed from lastSavedSession',
        JSON.stringify(lastSavedSession),
        JSON.stringify(sessionSavePayload),
      );
      await db.table(CHROMESESSION_DB_TABLE_NAME).add(sessionSavePayload);
      return sessionSavePayload;
    } else {
      return null;
    }
  }
}
