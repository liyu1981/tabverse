import { ChromeSession, IChromeSessionSavePayload } from './ChromeSession';
import { ISavedTabSpace, TabSpace } from '../tabSpace/TabSpace';

import { db } from '../../store/db';
import { filter } from 'lodash';
import { isIdNotSaved } from '../common';
import { getAllChromeSessionData } from './bootstrap';
import { SavedChromeSessionCollection } from './SavedChromeSessionCollection';
import { subscribePubSubMessage, TabSpaceDBMsg } from '../../message';
import { IDatabaseChange } from 'dexie-observable/api';
import { logger } from '../../global';

export type ISavedSessionGroup = {
  tag: string;
  sessions: IChromeSessionSavePayload[];
};

export type ITabSpaceMap = { [k: string]: ISavedTabSpace };
export type IDisplaySavedSessionGroup = ISavedSessionGroup & {
  tabSpaceMap: ITabSpaceMap;
};

export function monitorDbChanges(
  savedChromeSessionCollection: SavedChromeSessionCollection,
) {
  subscribePubSubMessage(
    TabSpaceDBMsg.Changed,
    (message, data: IDatabaseChange[]) => {
      logger.log('pubsub:', message, data);
      data.forEach((d) => {
        if (d.table === ChromeSession.DB_TABLE_NAME) {
          savedChromeSessionCollection.load();
        }
      });
    },
  );
}

export async function loadSavedSessionsAsGroups(): Promise<
  ISavedSessionGroup[]
> {
  const savedSessions = await db
    .table<IChromeSessionSavePayload>(ChromeSession.DB_TABLE_NAME)
    .orderBy('createdAt')
    .reverse()
    .toArray();
  const savedSessionGroups: ISavedSessionGroup[] = [];
  let lastGroup: ISavedSessionGroup | null = null;
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
  IDisplaySavedSessionGroup[]
> {
  const savedSessionGroups = await loadSavedSessionsAsGroups();
  if (savedSessionGroups.length <= 0) {
    return [];
  }

  const forDisplaySavedSessionGroups: IDisplaySavedSessionGroup[] = [];

  const generateTabSpaceMap = async (
    sessions: IChromeSessionSavePayload[],
  ): Promise<ITabSpaceMap> => {
    const map: ITabSpaceMap = {};
    await Promise.all(
      sessions.map(async (session) => {
        const toLoadTabSpaceIds = filter(
          session.windows.map((window) => window.tabSpaceId),
          (id) => !isIdNotSaved(id),
        );
        const savedTabSpaces = (
          await db
            .table<ISavedTabSpace>(TabSpace.DB_TABLE_NAME)
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
  await db.table(ChromeSession.DB_TABLE_NAME).delete(sessionId);
  getAllChromeSessionData().savedChromeSessionCollection.load();
}
