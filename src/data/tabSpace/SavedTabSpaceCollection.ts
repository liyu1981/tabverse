import {
  EmptyQuery,
  IFullTextSearchCursor,
  Query,
  calcCursorBegin,
} from '../../fullTextSearch';
import { LoadStatus, perfEnd, perfStart } from '../../global';
import {
  QUERY_PAGE_LIMIT_DEFAULT,
  addPagingToQueryParams,
} from '../../store/store';
import { action, computed, makeObservable, observable } from 'mobx';

import Moment from 'moment';
import { TabSpace } from './TabSpace';
import { TabSpaceStub } from '../../tabSpaceRegistry/TabSpaceRegistry';
import { getTabSpaceData } from './bootstrap';
import { getTabSpaceRegistry } from '../../tabSpaceRegistry';
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
  totalPageCount: number;
  query: Query;
  // when query is not empty we will use queryCursorPrev & queryCursorNext
  queryCursors: IFullTextSearchCursor[];
  queryCursorCurrentIndex: number;
  queryCursorsVisited: { [index: number]: boolean };
  queryCursorsLocked: boolean;
  // when query is empty we will use queryPageStart & queryPageLimit
  queryPageStart: number;
  queryPageLimit: number;

  constructor() {
    this.loadStatus = LoadStatus.Done;
    this.openedSavedTabSpaces = [];
    this.savedTabSpaces = [];
    this.sortMethod = SortMethods.CREATED;
    this.query = EmptyQuery;
    this.queryCursors = [];
    this.queryCursorCurrentIndex = -1;
    this.queryCursorsVisited = {};
    this.queryPageStart = 0;
    this.queryPageLimit = QUERY_PAGE_LIMIT_DEFAULT;
    this.totalPageCount = 0;

    makeObservable(this, {
      loadStatus: observable,
      openedSavedTabSpaces: observable,
      savedTabSpaces: observable,
      sortMethod: observable,
      query: observable,
      queryCursors: observable,
      queryCursorCurrentIndex: observable,
      queryPageStart: observable,
      queryPageLimit: observable,

      isEmpty: computed,
      isSearchMode: computed,
      sortedOpenedSavedTabSpaces: computed,
      sortedGroupedSavedTabSpaces: computed,
      cursorsForSearchPaging: computed,
      shouldShowSearchPaging: computed,

      setSortMethod: action,
      setQuery: action,
      setQueryPageStart: action,
      setQueryPageLimit: action,
      nextPage: action,
      prevPage: action,
      lastPage: action,
      firstPage: action,
      goQueryCursor: action,
      goQueryCursorNext: action,
      load: action,
    });
  }

  get isEmpty(): boolean {
    return (
      this.openedSavedTabSpaces.length > 0 || this.savedTabSpaces.length > 0
    );
  }

  get isSearchMode(): boolean {
    return !this.query.isEmpty();
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

  get cursorsForSearchPaging(): {
    availableCursors: IFullTextSearchCursor[];
    currentCursor: IFullTextSearchCursor | null;
    currentCursorIndex: number | null;
    nextCursor: IFullTextSearchCursor | null;
  } {
    const currentCursor =
      this.queryCursorCurrentIndex < this.queryCursors.length
        ? this.queryCursors[this.queryCursorCurrentIndex]
        : null;
    const nextCursor =
      this.queryCursors.length >= 1
        ? this.queryCursors[this.queryCursors.length - 1]
        : null;
    // copy from 0 to 2nd last cursors, as the last one is next cursor
    const availableCursors = this.queryCursors.slice(0, -1);
    return {
      availableCursors,
      currentCursor,
      currentCursorIndex:
        currentCursor === null ? null : this.queryCursorCurrentIndex,
      nextCursor,
    };
  }

  get shouldShowSearchPaging(): boolean {
    if (this.queryCursors.length <= 0) {
      return false;
    } else {
      const nextCursor = this.queryCursors[this.queryCursors.length - 1];
      if (this.queryCursors.length <= 2 && nextCursor.hasMorePage === false) {
        return false; // single page result case
      } else {
        return true;
      }
    }
  }

  setSortMethod(value: SortMethods) {
    this.sortMethod = value;
    this.load();
  }

  setQuery(value: Query) {
    this.query = value;
    if (this.query.isEmpty()) {
      this.queryPageStart = 0;
      this.queryPageLimit = QUERY_PAGE_LIMIT_DEFAULT;
    } else {
      this.queryCursors = [
        calcCursorBegin(this.query, QUERY_PAGE_LIMIT_DEFAULT),
      ];
      this.queryCursorCurrentIndex = 0;
      this.queryCursorsVisited = {};
    }
    this.load();
  }

  setQueryPageStart(value: number) {
    this.queryPageStart = value;
    this.load();
  }

  setQueryPageLimit(value: number) {
    this.queryPageLimit = value;
    this.load();
  }

  nextPage() {
    if (this.queryPageStart < this.totalPageCount - 1) {
      this.queryPageStart += 1;
      this.load();
    }
  }

  prevPage() {
    if (this.queryPageStart >= 1) {
      this.queryPageStart -= 1;
      this.load();
    }
  }

  lastPage() {
    this.queryPageStart = this.totalPageCount - 1;
    this.load();
  }

  firstPage() {
    this.queryPageStart = 0;
    this.load();
  }

  goQueryCursor(cursorIndex: number) {
    if (cursorIndex >= 0 && cursorIndex < this.queryCursors.length) {
      this.queryCursorCurrentIndex = cursorIndex;
      this.load();
    }
  }

  goQueryCursorNext() {
    if (this.queryCursors.length >= 1) {
      this.queryCursorCurrentIndex = this.queryCursors.length - 1;
      this.load();
    }
  }

  isTabSpaceOpened(tabSpaceId: string): boolean {
    return (
      this.openedSavedTabSpaces.findIndex(
        (tabSpaceStud) => tabSpaceStud.id === tabSpaceId,
      ) >= 0
    );
  }

  async load() {
    this.openedSavedTabSpaces = [];
    this.savedTabSpaces = [];

    this.loadStatus = LoadStatus.Loading;

    this.openedSavedTabSpaces = getTabSpaceRegistry()
      .registry.filter((tabSpaceStub) => !isIdNotSaved(tabSpaceStub.id))
      .toArray();

    let totalCount = 0;

    if (!this.query.isEmpty()) {
      perfStart('load:search');
      const currentCursor = this.queryCursors[this.queryCursorCurrentIndex];
      const [savedTabSpaces, nextCursor] = await searchSavedTabSpace({
        query: this.query,
        cursor: currentCursor,
      });
      this.savedTabSpaces = savedTabSpaces;
      if (!this.queryCursorsVisited[this.queryCursorCurrentIndex]) {
        this.queryCursors.push(nextCursor);
      }
      this.queryCursorsVisited[this.queryCursorCurrentIndex] = true;
      perfEnd('load:search');
    } else {
      perfStart('load:browse');
      const savedTabSpaceParams = addPagingToQueryParams(
        {},
        this.queryPageStart * this.queryPageLimit,
        this.queryPageLimit,
      );
      totalCount = getTabSpaceData().savedTabSpaceStore.totalSavedCount;
      this.savedTabSpaces = await querySavedTabSpace(savedTabSpaceParams);
      this.totalPageCount = Math.ceil(totalCount / this.queryPageLimit);

      if (this.queryPageStart >= this.totalPageCount) {
        this.queryPageStart = this.totalPageCount - 1;
      }
      this.totalPageCount = Math.ceil(totalCount / this.queryPageLimit);
      if (this.queryPageStart >= this.totalPageCount) {
        this.queryPageStart = this.totalPageCount - 1;
      }
      perfEnd('load:browse');
    }

    this.loadStatus = LoadStatus.Done;
  }
}
