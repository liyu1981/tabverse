import {
  ChromeSession,
  IChromeSessionSavePayload,
  NotTabSpaceTabId,
  isChromeSessionChanged,
} from './session';
import { debounce, logger } from '../../global';

import { db } from '../../store/db';
import { getLogger } from '../../store/store';
import { getNewId } from '../common';
import { isJestTest } from '../../debug';
import { loadSavedSessionsAsGroups } from './sessionStore';
import { scanCurrentTabsForBackground } from './chromeScan';

export function monitorChromeTabChanges(debounceTime: number) {
  const tag = getNewId();
  const sessionCreatedTime = Date.now();
  const commonResponder = debounce(() => {
    saveSession(tag, sessionCreatedTime);
  }, debounceTime);

  chrome.tabs.onAttached.addListener(commonResponder);
  chrome.tabs.onCreated.addListener(commonResponder);
  chrome.tabs.onDetached.addListener(commonResponder);
  chrome.tabs.onMoved.addListener(commonResponder);
  chrome.tabs.onReplaced.addListener(commonResponder);
  chrome.tabs.onRemoved.addListener(commonResponder);
  chrome.windows.onCreated.addListener(commonResponder);
  chrome.windows.onRemoved.addListener(commonResponder);
}

const MAX_SAVED_SESSIONS = isJestTest() ? 2 : 5;

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

export async function saveSession(
  tag: string,
  sessionCreatedTime: number,
): Promise<IChromeSessionSavePayload | null> {
  const session = new ChromeSession();
  session.tag = tag;
  session.createdAt = sessionCreatedTime;
  session.updatedAt = Date.now();
  await scanCurrentTabsForBackground(session);
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
    .filter((savedSession) => savedSession.tag === session.tag)
    .toArray();
  let sessionSavePayload: IChromeSessionSavePayload = null;
  if (lastSavedSessions.length <= 0) {
    sessionSavePayload = session.getSavePayload();
    logger.log('save session as lastSavedSessions.length <= 0');
    await db.table(ChromeSession.DB_TABLE_NAME).add(sessionSavePayload);
  } else {
    const lastSavedSession = lastSavedSessions[0];
    sessionSavePayload = session.getSavePayload();
    if (isChromeSessionChanged(lastSavedSession, sessionSavePayload)) {
      if (lastSavedSessions.length + 1 >= MAX_SAVED_SESSIONS) {
        const toDeleteSavedSessions = lastSavedSessions.slice(
          MAX_SAVED_SESSIONS - 1,
        );
        await db
          .table(ChromeSession.DB_TABLE_NAME)
          .bulkDelete(
            toDeleteSavedSessions.map(
              (toDeleteSavedSession) => toDeleteSavedSession.id,
            ),
          );
      }
      logger.log(
        'save session as changed from lastSavedSession',
        JSON.stringify(lastSavedSession),
        JSON.stringify(sessionSavePayload),
      );
      await db.table(ChromeSession.DB_TABLE_NAME).add(sessionSavePayload);
    }
  }
  return sessionSavePayload;
}

const MAX_SAVED_SESSION_GROUP = isJestTest() ? 2 : 64;

export async function dbAuditor(logs: string[]): Promise<void> {
  const logger = getLogger(logs);
  logger('sessionSaver dbAuditor start to process...');

  const savedSessionGroups = await loadSavedSessionsAsGroups();
  const toAuditSavedSessionGroups = savedSessionGroups.slice(
    1,
    MAX_SAVED_SESSION_GROUP,
  );
  const toDeleteSavedSessionGroups = savedSessionGroups.slice(
    MAX_SAVED_SESSION_GROUP,
  );
  await Promise.all(
    toAuditSavedSessionGroups.map((savedSessionGroup) => {
      const { sessions } = savedSessionGroup;
      const toDeleteSessionIds = sessions
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(1)
        .map((session) => session.id);
      toDeleteSessionIds.length > 0 &&
        logger(
          `found extra ${toDeleteSessionIds.length} sessions (${JSON.stringify(
            toDeleteSessionIds,
          )}) of tag ${savedSessionGroup.tag}, will prune.`,
        );
      return toDeleteSessionIds.length > 0
        ? db.table(ChromeSession.DB_TABLE_NAME).bulkDelete(toDeleteSessionIds)
        : Promise.resolve();
    }),
  );
  await Promise.all(
    toDeleteSavedSessionGroups.map((savedSessionGroup) => {
      const { sessions } = savedSessionGroup;
      const sessionIds = sessions.map((session) => session.id);
      sessionIds.length > 0 &&
        logger(
          `found ${sessionIds.length} stale sessions of tag ${
            savedSessionGroup.tag
          }: ${JSON.stringify(sessionIds)}, will prune.`,
        );
      return sessionIds.length > 0
        ? db.table(ChromeSession.DB_TABLE_NAME).bulkDelete(sessionIds)
        : Promise.resolve();
    }),
  );

  logger('sessionSaver dbAuditor finished processing.');
}
