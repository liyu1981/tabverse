import * as Moment from 'moment';

import {
  IDisplaySavedSessionGroup,
  loadSavedSessionsForDisplay,
} from './sessionStore';
import { action, computed, makeObservable, observable } from 'mobx';
import { flatten, uniq } from 'lodash';

export class SavedChromeSessionCollection {
  savedSessionGroups: IDisplaySavedSessionGroup[];
  savedVersion: number;

  constructor() {
    this.savedSessionGroups = [];
    this.savedVersion = 0;

    makeObservable(this, {
      savedSessionGroups: observable,
      savedVersion: observable,

      groupTags: computed,

      load: action,
      increaseSavedVersion: action,
    });
  }

  async load() {
    this.savedSessionGroups = await loadSavedSessionsForDisplay();
  }

  get groupTags() {
    return uniq(
      flatten(
        this.savedSessionGroups.map((sessionGroup) => {
          return sessionGroup.sessions.map((session) => {
            return Moment(session.createdAt).startOf('day').valueOf();
          });
        }),
      ),
    ).sort((a, b) => b - a);
  }

  increaseSavedVersion() {
    this.savedVersion += 1;
  }
}
