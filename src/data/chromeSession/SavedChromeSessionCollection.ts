import { startOfDayMs } from '../../time';
import { DisplaySavedSessionGroup } from './sessionStore';
import { flatten, uniq } from 'lodash';

import { LoadStatus } from '../../global';

export type SavedChromeSessionCollection = {
  loadStatus: LoadStatus;
  savedSessionGroups: DisplaySavedSessionGroup[];
};

export function newEmptySavedChromeSessionCollection(): SavedChromeSessionCollection {
  return {
    loadStatus: LoadStatus.Done,
    savedSessionGroups: [],
  };
}

export function getGroupTags(
  targetSavedChromeSessionCollection: SavedChromeSessionCollection,
): number[] {
  return uniq(
    flatten(
      targetSavedChromeSessionCollection.savedSessionGroups.map(
        (sessionGroup) => {
          return sessionGroup.sessions.map((session) => {
            return startOfDayMs(session.createdAt);
          });
        },
      ),
    ),
  ).sort((a, b) => b - a);
}
