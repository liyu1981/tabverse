import * as Moment from 'moment';

import { EmptyQuery, Query } from '../../fullTextSearch';
import { TabSpaceRegistry, TabSpaceStub } from './TabSpaceRegistry';
import { action, computed, makeObservable, observable } from 'mobx';
import { addPagingToQueryParams, queryPageLimit } from '../../store/store';

import { TabSpace } from './TabSpace';
import { isIdNotSaved } from '../common';
import { querySavedTabSpace } from './SavedTabSpaceStore';
import { searchSavedTabSpace } from '../../background/fullTextSearch/search';

export enum SortMethods {
  CREATED = 0,
  SAVED = 1,
}

export class SavedTabSpaceCollection {
  openedSavedTabSpaces: TabSpaceStub[];
  savedTabSpaces: TabSpace[];
  sortMethod: SortMethods;
  query: Query;
  queryPageStart: number;
  queryPageLimit: number;
  totalPageCount: number;

  constructor() {
    this.openedSavedTabSpaces = [];
    this.savedTabSpaces = [];
    this.sortMethod = SortMethods.CREATED;
    this.query = EmptyQuery;
    this.queryPageStart = 0;
    this.queryPageLimit = queryPageLimit;
    this.totalPageCount = 0;

    makeObservable(this, {
      openedSavedTabSpaces: observable,
      savedTabSpaces: observable,
      sortMethod: observable,
      query: observable,
      queryPageStart: observable,
      queryPageLimit: observable,

      isEmpty: computed,
      sortedOpenedSavedTabSpaces: computed,
      sortedGroupedSavedTabSpaces: computed,

      setSortMethod: action,
      setQuery: action,
      setQueryPageStart: action,
      setQueryPageLimit: action,
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

  setQuery(value: Query) {
    this.query = value;
  }

  setQueryPageStart(value: number) {
    this.queryPageStart = value;
  }

  setQueryPageLimit(value: number) {
    this.queryPageLimit = value;
  }

  nextPage() {
    if (this.queryPageStart < this.totalPageCount - 1) {
      this.queryPageStart += 1;
    }
  }

  prevPage() {
    if (this.queryPageStart >= 1) {
      this.queryPageStart -= 1;
    }
  }

  isTabSpaceOpened(tabSpaceId: string): boolean {
    return (
      this.openedSavedTabSpaces.findIndex(
        (tabSpaceStud) => tabSpaceStud.id === tabSpaceId,
      ) >= 0
    );
  }

  async load(tabSpaceRegistry: TabSpaceRegistry) {
    this.openedSavedTabSpaces = tabSpaceRegistry.registry
      .filter((tabSpaceStub) => !isIdNotSaved(tabSpaceStub.id))
      .toArray();

    if (!this.query.isEmpty()) {
      console.log('will search:', this.query);
      this.savedTabSpaces = await searchSavedTabSpace({
        query: this.query,
        pageStart: this.queryPageStart,
        pageLimit: this.queryPageLimit,
      });
    } else {
      console.log('will browse:', this.query);
      const savedTabSpaceParams = addPagingToQueryParams(
        {},
        this.queryPageStart,
        this.queryPageLimit,
      );
      this.savedTabSpaces = await querySavedTabSpace(savedTabSpaceParams);
    }

    this.totalPageCount = Math.ceil(
      this.savedTabSpaces.length / this.queryPageLimit,
    );

    if (this.queryPageStart >= this.totalPageCount) {
      this.queryPageStart = this.totalPageCount - 1;
    }
  }
}
