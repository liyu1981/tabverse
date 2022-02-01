import * as Moment from 'moment';

import {
  IDisplaySavedSessionGroup,
  loadSavedSessionsForDisplay,
} from './sessionStore';
import { action, computed, makeObservable, observable } from 'mobx';
import { flatten, uniq } from 'lodash';

export class SavedChromeSessionCollection {
  savedSessionGroups: IDisplaySavedSessionGroup[];

  constructor() {
    this.savedSessionGroups = [];

    makeObservable(this, {
      savedSessionGroups: observable,

      groupTags: computed,

      load: action,
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
}
