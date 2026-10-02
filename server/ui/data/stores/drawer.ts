/**
 * The tabverse drawer: which tabverse is on screen, and its bundle.
 *
 * A drawer rather than a page (adr/0015): the console browses a whole account
 * at a time, and a tabverse used to replace that whole account to show itself -
 * you lost the list you were picking from, the account you were looking at and
 * the tab you were on.
 */

import { createEvent, createStore } from 'effector';

import { deleteTabspaceFx, loadTabspaceFx } from '../effects';
import type { TabspaceBundle } from '../types';

export const openTabspace = createEvent<string>();
export const closeTabspace = createEvent();

export const $openTabspaceId = createStore<string>('')
  .on(openTabspace, (_, id) => id)
  .on(closeTabspace, () => '');

export const $bundle = createStore<TabspaceBundle | null>(null)
  .on(loadTabspaceFx.doneData, (_, bundle) => bundle)
  .on(openTabspace, () => null)
  .on(closeTabspace, () => null);

export const $bundleError = createStore<string>('')
  .on(loadTabspaceFx, () => '')
  .on(loadTabspaceFx.failData, (_, error) => error?.message || 'not found')
  // A tabverse that was deleted while the drawer was open (another operator,
  // another tab of this console) is not something to keep showing.
  .on(deleteTabspaceFx.done, () => 'This tabverse was deleted.');

export const $drawerOpen = $openTabspaceId.map((id) => !!id);
