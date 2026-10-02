/**
 * The stored-data panel's three views over one account: the tabverse list, the
 * raw record browser and the full text search.
 *
 * Filters, paging and results are separate stores on purpose. A filter is what
 * the operator typed, a page is where they are in the results, and the results
 * are what the server last said - collapsing them into one object is what makes
 * a list lose its place when a background refresh lands.
 */

import { createEvent, createStore } from 'effector';

import { loadRecordsFx, loadTabspacesFx, searchFx } from '../effects';
import type { AdminSearchHit, RecordPage, TabspacePage } from '../types';

export const setTabspaceQuery = createEvent<string>();
export const pageTabspaces = createEvent<number>();
export const setRecordQuery = createEvent<string>();
export const setRecordEntity = createEvent<string>();
export const setRecordDeleted = createEvent<boolean>();
export const pageRecords = createEvent<number>();
export const setSearchQuery = createEvent<string>();
export const setSearchEntity = createEvent<string>();
/** A new account starts at the top of both lists with nothing filtered. */
export const resetBrowse = createEvent();

const TABSPACE_PAGE = 24;
const RECORD_PAGE = 50;

export interface TabspaceListState {
  items: TabspacePage['tabspaces'];
  total: number;
  offset: number;
  limit: number;
  q: string;
  loading: boolean;
}

export interface RecordListState {
  items: RecordPage['records'];
  total: number;
  offset: number;
  limit: number;
  q: string;
  entity: string;
  deleted: boolean;
  loading: boolean;
}

const newTabspaceState = (): TabspaceListState => ({
  items: [],
  total: 0,
  offset: 0,
  limit: TABSPACE_PAGE,
  q: '',
  loading: false,
});

const newRecordState = (): RecordListState => ({
  items: [],
  total: 0,
  offset: 0,
  limit: RECORD_PAGE,
  q: '',
  entity: '',
  deleted: false,
  loading: false,
});

export const $tabspaces = createStore<TabspaceListState>(newTabspaceState())
  .on(loadTabspacesFx, (state) => ({ ...state, loading: true }))
  .on(loadTabspacesFx.doneData, (state, page) => ({
    ...state,
    items: page?.tabspaces || [],
    total: page?.total || 0,
    loading: false,
  }))
  .on(loadTabspacesFx.fail, (state) => ({ ...state, loading: false }))
  .on(setTabspaceQuery, (state, q) => ({ ...state, q, offset: 0 }))
  .on(pageTabspaces, (state, offset) => ({ ...state, offset }))
  .reset(resetBrowse);

export const $records = createStore<RecordListState>(newRecordState())
  .on(loadRecordsFx, (state) => ({ ...state, loading: true }))
  .on(loadRecordsFx.doneData, (state, page) => ({
    ...state,
    items: page?.records || [],
    total: page?.total || 0,
    loading: false,
  }))
  .on(loadRecordsFx.fail, (state) => ({ ...state, loading: false }))
  .on(setRecordQuery, (state, q) => ({ ...state, q, offset: 0 }))
  .on(setRecordEntity, (state, entity) => ({ ...state, entity, offset: 0 }))
  .on(setRecordDeleted, (state, deleted) => ({ ...state, deleted, offset: 0 }))
  .on(pageRecords, (state, offset) => ({ ...state, offset }))
  .reset(resetBrowse);

export interface SearchState {
  q: string;
  entity: string;
  hits: AdminSearchHit[];
  /** The message the panel shows instead of results: an error, or nothing
   *  typed yet. An empty hit list is not a message. */
  problem: string;
  searched: boolean;
  loading: boolean;
}

export const $search = createStore<SearchState>({
  q: '',
  entity: '',
  hits: [],
  problem: '',
  searched: false,
  loading: false,
})
  .on(setSearchQuery, (state, q) => ({ ...state, q }))
  .on(setSearchEntity, (state, entity) => ({ ...state, entity }))
  .on(searchFx, (state) => ({ ...state, loading: true, problem: '' }))
  .on(searchFx.doneData, (state, result) => ({
    ...state,
    hits: result.hits || [],
    loading: false,
    searched: true,
  }))
  .on(searchFx.failData, (state, error) => ({
    ...state,
    hits: [],
    loading: false,
    searched: true,
    problem: error?.message || 'search failed',
  }))
  .reset(resetBrowse);

/** "1–24 of 60", the pager's own words. */
export function pageLabel(
  total: number,
  offset: number,
  limit: number,
): string {
  if (!total) return '0 of 0';
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return `${from}–${to} of ${total}`;
}
