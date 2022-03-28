import {
  ChromeSessionSavePayload,
  CHROMESESSION_DB_SCHEMA,
  CHROMESESSION_DB_TABLE_NAME,
} from './ChromeSession';

import { db } from '../../store/db';
import { filter } from 'lodash';
import { isIdNotSaved } from '../common';
import { subscribePubSubMessage, TabSpaceDBMsg } from '../../message/message';
import { IDatabaseChange } from 'dexie-observable/api';
import { logger } from '../../global';
import {
  TabSpaceSavePayload,
  TABSPACE_DB_TABLE_NAME,
} from '../tabSpace/TabSpace';
import { reloadSavedChromeSessionCollection } from './store';

export type SavedSessionGroup = {
  tag: string;
  sessions: ChromeSessionSavePayload[];
};

export type TabSpaceMap = { [k: string]: TabSpaceSavePayload };
export type DisplaySavedSessionGroup = SavedSessionGroup & {
  tabSpaceMap: TabSpaceMap;
};

export function monitorDbChanges() {
  subscribePubSubMessage(
    TabSpaceDBMsg.Changed,
    (message, data: IDatabaseChange[]) => {
      logger.log('pubsub:', message, data);
      data.forEach((d) => {
        if (d.table === CHROMESESSION_DB_SCHEMA) {
          reloadSavedChromeSessionCollection();
        }
      });
    },
  );
}

export async function loadSavedSessionsAsGroups(): Promise<
  SavedSessionGroup[]
> {
  const savedSessions = await db
    .table<ChromeSessionSavePayload>(CHROMESESSION_DB_TABLE_NAME)
    .orderBy('createdAt')
    .reverse()
    .toArray();
  const savedSessionGroups: SavedSessionGroup[] = [];
  let lastGroup: SavedSessionGroup | null = null;
  savedSessions.forEach((savedSession) => {
    if (lastGroup === null) {
      lastGroup = { tag: savedSession.tag, sessions: [savedSession] };
      savedSessionGroups.push(lastGroup);
    } else {
      if (lastGroup.tag === savedSession.tag) {
        lastGroup.sessions.push(savedSession);
      } else {
        lastGroup = { tag: savedSession.tag, sessions: [savedSession] };
        savedSessionGroups.push(lastGroup);
      }
    }
  });
  return savedSessionGroups.map((savedSessionGroup) => {
    savedSessionGroup.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    return savedSessionGroup;
  });
}

export async function loadSavedSessionsForDisplay(): Promise<
  DisplaySavedSessionGroup[]
> {
  const savedSessionGroups = await loadSavedSessionsAsGroups();
  if (savedSessionGroups.length <= 0) {
    return [];
  }

  const forDisplaySavedSessionGroups: DisplaySavedSessionGroup[] = [];

  const generateTabSpaceMap = async (
    sessions: ChromeSessionSavePayload[],
  ): Promise<TabSpaceMap> => {
    const map: TabSpaceMap = {};
    await Promise.all(
      sessions.map(async (session) => {
        const toLoadTabSpaceIds = filter(
          session.windows.map((window) => window.tabSpaceId),
          (id) => !isIdNotSaved(id),
        );
        const savedTabSpaces = (
          await db
            .table<TabSpaceSavePayload>(TABSPACE_DB_TABLE_NAME)
            .bulkGet(toLoadTabSpaceIds)
        ).filter((x) => x);
        savedTabSpaces.forEach(
          (savedTabSpace) => (map[savedTabSpace.id] = savedTabSpace),
        );
      }),
    );
    return map;
  };

  // the most recent one we will keep all savings
  const mostRecentSession = {
    tag: savedSessionGroups[0].tag,
    sessions: savedSessionGroups[0].sessions,
    tabSpaceMap: await generateTabSpaceMap(savedSessionGroups[0].sessions),
  };
  forDisplaySavedSessionGroups.push(mostRecentSession);

  // for rest of groups we display only the last updated one
  await Promise.all(
    savedSessionGroups.slice(1).map(async (group) => {
      const displaySessions = group.sessions.slice(0, 1);
      forDisplaySavedSessionGroups.push({
        tag: group.tag,
        sessions: displaySessions,
        tabSpaceMap: await generateTabSpaceMap(displaySessions),
      });
    }),
  );
  return forDisplaySavedSessionGroups;
}

export async function deleteSavedSession(sessionId: string) {
  await db.table(CHROMESESSION_DB_TABLE_NAME).delete(sessionId);
  reloadSavedChromeSessionCollection();
}
