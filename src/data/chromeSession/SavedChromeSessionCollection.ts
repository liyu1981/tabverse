import {
  IDisplaySavedSessionGroup,
  loadSavedSessionsForDisplay,
} from './sessionStore';
import { action, computed, makeObservable, observable } from 'mobx';
import { flatten, uniq } from 'lodash';

import { LoadStatus } from '../../global';
import Moment from 'moment';

export class SavedChromeSessionCollection {
  loadStatus: LoadStatus;
  savedSessionGroups: IDisplaySavedSessionGroup[];

  constructor() {
    this.loadStatus = LoadStatus.Done;
    this.savedSessionGroups = [];

    makeObservable(this, {
      loadStatus: observable,
      savedSessionGroups: observable,

      groupTags: computed,

      load: action,
    });
  }

  async load() {
    this.savedSessionGroups = [];
    this.loadStatus = LoadStatus.Loading;
    this.savedSessionGroups = await loadSavedSessionsForDisplay();
    this.loadStatus = LoadStatus.Done;
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
