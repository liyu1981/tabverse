import * as Moment from 'moment';

import { EmptyQuery, Query } from '../../fullTextSearch';
import { LoadStatus, perfEnd, perfStart } from '../../global';
import {
  QUERY_PAGE_LIMIT_DEFAULT,
  addPagingToQueryParams,
} from '../../store/store';
import {
  TabSpaceRegistry,
  TabSpaceStub,
} from '../../tabSpaceRegistry/TabSpaceRegistry';
import { action, computed, makeObservable, observable } from 'mobx';

import { TabSpace } from './TabSpace';
import { isIdNotSaved } from '../common';
import { querySavedTabSpace } from './SavedTabSpaceStore';
import { searchSavedTabSpace } from '../../background/fullTextSearch/search';

export enum SortMethods {
  CREATED = 0,
  SAVED = 1,
}

export class SavedTabSpaceCollection {
  loadStatus: LoadStatus;
  openedSavedTabSpaces: TabSpaceStub[];
  savedTabSpaces: TabSpace[];
  sortMethod: SortMethods;
  query: Query;
  queryPageStart: number;
  queryPageLimit: number;
  totalPageCount: number;

  constructor() {
    this.loadStatus = LoadStatus.Done;
    this.openedSavedTabSpaces = [];
    this.savedTabSpaces = [];
    this.sortMethod = SortMethods.CREATED;
    this.query = EmptyQuery;
    this.queryPageStart = 0;
    this.queryPageLimit = QUERY_PAGE_LIMIT_DEFAULT;
    this.totalPageCount = 0;

    makeObservable(this, {
      loadStatus: observable,
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
    this.openedSavedTabSpaces = [];
    this.savedTabSpaces = [];

    this.loadStatus = LoadStatus.Loading;

    this.openedSavedTabSpaces = tabSpaceRegistry.registry
      .filter((tabSpaceStub) => !isIdNotSaved(tabSpaceStub.id))
      .toArray();

    if (!this.query.isEmpty()) {
      perfStart('load:search');
      this.savedTabSpaces = await searchSavedTabSpace({
        query: this.query,
        pageStart: this.queryPageStart,
        pageLimit: this.queryPageLimit,
      });
      perfEnd('load:search');
    } else {
      perfStart('load:browse');
      const savedTabSpaceParams = addPagingToQueryParams(
        {},
        this.queryPageStart,
        this.queryPageLimit,
      );
      this.savedTabSpaces = await querySavedTabSpace(savedTabSpaceParams);
      perfEnd('load:browse');
    }

    this.totalPageCount = Math.ceil(
      this.savedTabSpaces.length / this.queryPageLimit,
    );

    if (this.queryPageStart >= this.totalPageCount) {
      this.queryPageStart = this.totalPageCount - 1;
    }
    this.loadStatus = LoadStatus.Done;
  }
}
