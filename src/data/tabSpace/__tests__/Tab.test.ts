import { getNewId } from '../../common';
import { List } from 'immutable';

import { TABSPACE_DB_VERSION } from '../../../global';
import {
  SPLIT_VIEW_ID_NONE,
  Tab,
  newEmptyTab,
  fromLiveTab,
  setTabSpaceId,
  convertAndGetTabSavePayload,
  findSplitPartner,
  fromSavedTab,
} from '../Tab';

test('constructor', () => {
  const t = newEmptyTab();
  expect(t.id.length).toBeGreaterThan(0);
  expect(t.createdAt).toBe(-1);
  expect(t.updatedAt).toBe(-1);
  expect(t.version).toBe(TABSPACE_DB_VERSION);
});

test('convertAndGetSavePayload', () => {
  const t = setTabSpaceId(
    getNewId(),
    fromLiveTab({ chromeTabId: 1000, chromeWindowId: 1001 }),
  );
  expect(t.chromeTabId).toBe(1000);
  expect(t.chromeWindowId).toBe(1001);
  const { tab, savedTab } = convertAndGetTabSavePayload(t, t.id);
  // a save stamps the times; the id is already final and is not touched
  expect(savedTab.id).toEqual(t.id);
  expect(tab.id).toEqual(t.id);
  expect(tab.tabSpaceId).toEqual(t.id);
  expect(savedTab.createdAt).toBeGreaterThan(0);
  expect(savedTab.updatedAt).toBeGreaterThan(0);
  expect(tab.createdAt).toEqual(savedTab.createdAt);
  expect(tab.updatedAt).toEqual(savedTab.updatedAt);
  expect(tab.id).toEqual(savedTab.id);
});

test('fromSavedData', () => {
  const savedData = {
    version: 1,
    id: '1234567',
    createdAt: 12345,
    updatedAt: 123456,
    tabSpaceId: 'abcde',
    title: 'test',
    url: 'http://www.test.com',
    favIconUrl: 'http://www.test.com/icon',
    suspended: false,
    pinned: false,
  };
  const t = fromSavedTab(savedData);
  Object.keys(savedData).forEach((key) => {
    expect(t[key]).toEqual(savedData[key]);
  });
});

// The split pairing travels in two forms (ADR 0022): the saved one names the
// partner by tab id, and Chrome's own id is all a live tabverse has.
describe('findSplitPartner', () => {
  const tabWith = (id: string, extra: Partial<Tab>) =>
    ({ ...newEmptyTab(), id, ...extra }) as Tab;

  it('finds the partner Chrome names, when the record does not', () => {
    const left = tabWith('t1', { splitViewId: 7 });
    const right = tabWith('t2', { splitViewId: 7 });
    const other = tabWith('t3', { splitViewId: 9 });
    const all = List<Tab>([left, right, other]);
    expect(findSplitPartner(left, all)?.id).toBe('t2');
    expect(findSplitPartner(other, all)?.id).toBeUndefined();
  });

  it('finds a partner the record names, with no chrome id at all', () => {
    // This is the shape a saved tabverse has after a reload, and the shape the
    // console draws from: no live tab, no live split id, just the pairing.
    const left = tabWith('t1', { splitWith: 't2' });
    const right = tabWith('t2', { splitWith: 't1' });
    const all = List<Tab>([left, right]);
    expect(findSplitPartner(left, all)?.id).toBe('t2');
    expect(findSplitPartner(right, all)?.id).toBe('t1');
  });

  it('prefers the recorded partner over a chrome id that says otherwise', () => {
    // Two devices on one account each have a "split view 7". If the console
    // trusted the number it would pair up four unrelated tabs, so the id the
    // record carries wins.
    const recorded = tabWith('t1', { splitWith: 't2', splitViewId: 7 });
    const named = tabWith('t2', { splitWith: 't1' });
    const otherDevice = tabWith('t3', { splitWith: 't4', splitViewId: 7 });
    const all = List<Tab>([recorded, named, otherDevice]);
    expect(findSplitPartner(recorded, all)?.id).toBe('t2');
  });

  it('falls back to chrome when the recorded partner is gone', () => {
    // The partner was deleted since the save. The tab may well still be split
    // in the window, and a block with one tab in it is worse than no block.
    const left = tabWith('t1', { splitWith: 'deleted-tab', splitViewId: 7 });
    const right = tabWith('t2', { splitViewId: 7 });
    expect(findSplitPartner(left, List<Tab>([left, right]))?.id).toBe('t2');
    // ...and with nothing live either, there is no partner at all.
    expect(findSplitPartner(left, List<Tab>([left]))).toBeUndefined();
  });

  it('is not its own partner', () => {
    const alone = tabWith('t1', { splitWith: 't1', splitViewId: 7 });
    expect(findSplitPartner(alone, List<Tab>([alone]))).toBeUndefined();
  });

  it('draws the recorded pairing even after chrome says the split is gone', () => {
    // The record is what is drawn and what the console draws; chrome corrects it
    // at the next save. So the window closing a split changes the tabverse a
    // little later - within a minute, because the rescan asks - and until then the
    // list shows the layout the record last agreed to.
    const left = tabWith('t1', {
      splitWith: 't2',
      splitViewId: SPLIT_VIEW_ID_NONE,
    });
    const right = tabWith('t2', {
      splitWith: 't1',
      splitViewId: SPLIT_VIEW_ID_NONE,
    });
    expect(findSplitPartner(left, List<Tab>([left, right]))?.id).toBe('t2');
  });

  it('does not pair two tabs chrome has both said are unsplit', () => {
    const left = tabWith('t1', { splitViewId: SPLIT_VIEW_ID_NONE });
    const right = tabWith('t2', { splitViewId: SPLIT_VIEW_ID_NONE });
    expect(findSplitPartner(left, List<Tab>([left, right]))).toBeUndefined();
  });
});
