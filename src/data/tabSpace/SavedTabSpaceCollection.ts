import { TabSpaceRegistry, TabSpaceStub } from './TabSpaceRegistry';
import { action, makeObservable, observable } from 'mobx';
import { addPagingToQueryParams, queryPageLimit } from '../../store/store';

import { List } from 'immutable';
import { TabSpace } from './TabSpace';
import { getTabSpaceData } from './bootstrap';
import { isIdNotSaved } from '../common';
import { querySavedTabSpace } from './SavedTabSpaceStore';

export enum SortMethods {
  CREATED = 0,
  SAVED = 1,
}

export class SavedTabSpaceCollection {
  openedSavedTabSpaces: TabSpaceStub[];
  savedTabSpaces: TabSpace[];
  sortMethod: SortMethods;
  savedTabSpacesPageStart: number;
  queryPageLimit: number;
  totalPageCount: number;

  constructor() {
    this.openedSavedTabSpaces = [];
    this.savedTabSpaces = [];
    this.sortMethod = SortMethods.CREATED;
    this.savedTabSpacesPageStart = 0;
    this.queryPageLimit = queryPageLimit;
    this.totalPageCount = 0;

    makeObservable(this, {
      openedSavedTabSpaces: observable,
      savedTabSpaces: observable,
      sortMethod: observable,
      savedTabSpacesPageStart: observable,
      queryPageLimit: observable,

      setSortMethod: action,
      nextPage: action,
      prevPage: action,
      load: action,
    });
  }

  setSortMethod(value: SortMethods) {
    this.sortMethod = value;
  }

  nextPage() {
    if (this.savedTabSpacesPageStart < this.totalPageCount - 1) {
      this.savedTabSpacesPageStart += 1;
    }
  }

  prevPage() {
    if (this.savedTabSpacesPageStart >= 1) {
      this.savedTabSpacesPageStart -= 1;
    }
  }

  async load(tabSpaceRegistry: TabSpaceRegistry) {
    this.openedSavedTabSpaces = tabSpaceRegistry.registry
      .filter((tabSpaceStub) => !isIdNotSaved(tabSpaceStub.id))
      .toArray();

    const savedTabSpaceParams = addPagingToQueryParams(
      {
        noneOf: List(tabSpaceRegistry.registry.keys()).toArray(),
      },
      this.savedTabSpacesPageStart,
    );
    this.savedTabSpaces = await querySavedTabSpace(savedTabSpaceParams);

    this.totalPageCount = Math.ceil(
      this.savedTabSpaces.length / this.queryPageLimit,
    );

    if (this.savedTabSpacesPageStart >= this.totalPageCount) {
      this.savedTabSpacesPageStart = this.totalPageCount - 1;
    }
  }
}
