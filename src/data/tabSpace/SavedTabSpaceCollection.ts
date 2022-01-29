import { TabSpaceRegistry, TabSpaceStub } from './TabSpaceRegistry';
import { action, computed, makeObservable, observable } from 'mobx';
import { addPagingToQueryParams, queryPageLimit } from '../../store/store';

import { List } from 'immutable';
import { TabSpace } from './TabSpace';
import { isIdNotSaved } from '../common';
import { querySavedTabSpace } from './SavedTabSpaceStore';
import * as Moment from 'moment';

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

      isEmpty: computed,
      sortedOpenedSavedTabSpaces: computed,
      sortedGroupedSavedTabSpaces: computed,

      setSortMethod: action,
      nextPage: action,
      prevPage: action,
      load: action,
    });
  }

  get isEmpty(): boolean {
    return (
      this.openedSavedTabSpaces.length > 0 || this.savedTabSpaces.length > 0
    );
  }

  get sortedOpenedSavedTabSpaces(): TabSpaceStub[] {
    const clonedOpenedSavedTabSpaces = this.openedSavedTabSpaces.slice(0);
    this.sortMethod === SortMethods.SAVED
      ? clonedOpenedSavedTabSpaces.sort((a, b) => b.updatedAt - a.updatedAt)
      : clonedOpenedSavedTabSpaces.sort((a, b) => b.createdAt - a.createdAt);
    return clonedOpenedSavedTabSpaces;
  }

  get sortedGroupedSavedTabSpaces(): [string, [string, TabSpace[]][]] {
    const clonedSavedTabSpaces = this.savedTabSpaces.slice(0);
    this.sortMethod === SortMethods.SAVED
      ? clonedSavedTabSpaces.sort((a, b) => b.updatedAt - a.updatedAt)
      : clonedSavedTabSpaces.sort((a, b) => b.createdAt - a.createdAt);

    const result = clonedSavedTabSpaces.reduce((groups, savedTabSpace) => {
      const m = Moment(
        this.sortMethod === SortMethods.SAVED
          ? savedTabSpace.updatedAt
          : savedTabSpace.createdAt,
      ).fromNow();
      if (groups.length <= 0) {
        groups.push([m, [savedTabSpace]]);
      } else {
        const [lastGroupM, lastGroup] = groups[groups.length - 1];
        if (lastGroupM !== m) {
          groups.push([m, [savedTabSpace]]);
        } else {
          lastGroup.push(savedTabSpace);
        }
      }
      return groups;
    }, []) as [string, TabSpace[]][];

    return [
      this.sortMethod === SortMethods.SAVED ? 'saved' : 'created',
      result,
    ];
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
