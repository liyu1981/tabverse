import { DisplaySavedSessionGroup } from './sessionStore';
import { flatten, uniq } from 'lodash';

import { LoadStatus } from '../../global';
import Moment from 'moment';

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
            return Moment(session.createdAt).startOf('day').valueOf();
          });
        },
      ),
    ),
  ).sort((a, b) => b - a);
}
