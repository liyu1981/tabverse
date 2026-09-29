import { getSavedId, isIdNotSaved } from '../../common';

import {
  addTabs,
  convertAndGetTabSpaceSavePayload,
  findTabByChromeTabId,
  findTabById,
  fromSavedDataWithoutTabs,
  getTabIds,
  insertTab,
  needAutoSave,
  newEmptyTabSpace,
  removeTab,
  removeTabByChromeTabId,
  removeTabById,
  replaceTab,
  replaceAllTabs,
  reset,
  setChromeTabId,
  setChromeWindowId,
  setId,
  setTabGroups,
  setName,
  updateTab,
  updateTabSpace,
} from '../TabSpace';
import {
  setChromeTabId as tabSetChromeTabId,
  setChromeWindowId as tabSetChromeWindowId,
  setId as tabSetId,
} from '../Tab';
import { newEmptyTab } from '../Tab';

test('constructor', () => {
  const ts = newEmptyTabSpace();
  expect(ts.name).toEqual('');
  expect(ts.chromeTabId).toBe(-1);
  expect(ts.chromeWindowId).toBe(-1);
  // a fresh in-memory tabspace still has the '~' id, but tabverses are born
  // saved now, so autosave is always allowed (ADR: tvid in the tab url)
  expect(isIdNotSaved(ts.id)).toBeTruthy();
  expect(needAutoSave(ts)).toBeTruthy();

  const ts5 = setChromeTabId(
    300,
    setChromeWindowId(301, setName('Window-301', setId('testts5', ts))),
  );
  expect(ts5.id).toBe('testts5');
  expect(ts5.name).toBe('Window-301');
  expect(ts5.chromeTabId).toBe(300);
  expect(ts5.chromeWindowId).toBe(301);

  const ts7 = reset({ newId: 'testts7' }, ts);
  expect(ts7.chromeTabId).toBe(-1);
  expect(ts7.chromeWindowId).toBe(-1);
  expect(ts7.id).toBe('testts7');
});

test('findTabById/findTabByChromeTabId', () => {
  let ts = newEmptyTabSpace();
  const t1 = tabSetChromeTabId(100, tabSetChromeWindowId(1000, newEmptyTab()));
  ts = insertTab({ tab: t1 }, ts);
  const t2 = tabSetChromeTabId(101, tabSetChromeWindowId(1000, newEmptyTab()));
  ts = insertTab({ tab: t2 }, ts);

  expect(findTabById(t1.id, ts).chromeTabId).toEqual(t1.chromeTabId);
  expect(findTabByChromeTabId(t2.chromeTabId, ts).id).toEqual(t2.id);
});

test('addTab/addTabs', () => {
  let ts = newEmptyTabSpace();
  const t1 = newEmptyTab();
  const t2 = newEmptyTab();
  const t3 = newEmptyTab();
  const t4 = newEmptyTab();
  ts = insertTab({ tab: t1 }, ts);
  ts = insertTab({ tab: t2, index: -1 }, ts);
  ts = insertTab({ tab: t3, index: 2 }, ts);
  ts = insertTab({ tab: t4, index: 1 }, ts);
  expect(getTabIds(ts)).toEqual([t2.id, t4.id, t1.id, t3.id]);
  ts.tabs.forEach((tab) => {
    expect(tab.tabSpaceId).toEqual(ts.id);
  });

  const t5 = newEmptyTab();
  const t6 = newEmptyTab();
  ts = addTabs([t5, t6], ts);
  expect(getTabIds(ts)).toEqual([t2.id, t4.id, t1.id, t3.id, t5.id, t6.id]);
});

test('updateTab', () => {
  let ts = newEmptyTabSpace();
  const t1 = newEmptyTab();
  ts = insertTab({ tab: t1 }, ts);

  const t2 = newEmptyTab();
  ts = insertTab({ tab: t2 }, ts);
  const changedTitle = t2.title + 'changed';
  ts = updateTab({ tid: t2.id, changes: { title: changedTitle } }, ts);

  expect(findTabById(t2.id, ts).title).toEqual(changedTitle);

  const t3 = newEmptyTab();
  const t4 = newEmptyTab();
  ts = replaceAllTabs([t3, t4], ts);
  expect(getTabIds(ts)).toEqual([t3.id, t4.id]);
});

test('removeTab/removeTabById/removeTabByChromeTabId', () => {
  let ts = newEmptyTabSpace();
  const t1 = tabSetChromeTabId(100, tabSetChromeWindowId(1000, newEmptyTab()));
  const t2 = tabSetChromeTabId(101, tabSetChromeWindowId(1000, newEmptyTab()));
  const t3 = tabSetChromeTabId(102, tabSetChromeWindowId(1000, newEmptyTab()));
  ts = addTabs([t1, t2, t3], ts);

  ts = removeTabById('888', ts);
  expect(getTabIds(ts)).toEqual([t1.id, t2.id, t3.id]);
  ts = removeTabById(t1.id, ts);
  expect(getTabIds(ts)).toEqual([t2.id, t3.id]);
  ts = removeTabByChromeTabId(t2.chromeTabId, ts);
  expect(getTabIds(ts)).toEqual([t3.id]);
  ts = removeTab(t3, ts);
  expect(getTabIds(ts).length).toEqual(0);
});

test('replaceTab/replaceAllTabs', () => {
  let ts = newEmptyTabSpace();
  const t1 = newEmptyTab();
  const t2 = newEmptyTab();
  const t3 = newEmptyTab();
  const t4 = newEmptyTab();
  ts = addTabs([t1, t2, t3], ts);

  ts = replaceTab({ tid: t2.id, tab: t4 }, ts);
  expect(getTabIds(ts)).toEqual([t1.id, t4.id, t3.id]);
  ts = replaceTab({ tid: '999', tab: t2 }, ts);
  expect(getTabIds(ts)).toEqual([t1.id, t4.id, t3.id]);

  ts = replaceAllTabs([t3, t2, t4], ts);
  expect(getTabIds(ts)).toEqual([t3.id, t2.id, t4.id]);
});

test('update', () => {
  let ts = newEmptyTabSpace();
  ts = updateTabSpace({ name: 'test' }, ts);
  expect(ts.name).toEqual('test');
});

test('convertAndGetSavePayload', () => {
  let ts = newEmptyTabSpace();
  const t1 = newEmptyTab();
  ts = insertTab({ tab: t1 }, ts);
  const {
    tabSpace,
    tabSpaceSavePayload,
    isNewTabSpace,
    newTabSavePayloads,
    existTabSavePayloads,
  } = convertAndGetTabSpaceSavePayload(ts);
  expect(isIdNotSaved(tabSpace.id)).toBeFalsy();
  expect(tabSpaceSavePayload.tabIds).toEqual([getSavedId(t1.id)]);
  expect(isNewTabSpace).toBeTruthy();
  expect(newTabSavePayloads[0].id).toEqual(getSavedId(t1.id));
  expect(newTabSavePayloads[0].tabSpaceId).toEqual(getSavedId(ts.id));
  expect(existTabSavePayloads.length).toEqual(0);

  const ts4 = fromSavedDataWithoutTabs(tabSpaceSavePayload);
  expect(isIdNotSaved(ts4.id)).toBeFalsy();
  expect(ts4.tabs.size).toEqual(0);
});

test('reset', () => {
  let ts = newEmptyTabSpace();
  ts = reset({ chromeTabId: 100, chromeWindowId: 101 }, ts);
  expect(isIdNotSaved(ts.id)).toBeTruthy();
  expect(ts.chromeTabId).toBe(100);
  expect(ts.chromeWindowId).toBe(101);

  ts = setChromeTabId(200, setChromeWindowId(201, ts));
  expect(ts.chromeTabId).toBe(200);
  expect(ts.chromeWindowId).toBe(201);
});

test('the save payload keeps pinned tabs and group hints', () => {
  let ts = newEmptyTabSpace();
  ts = setId('ts1', ts);
  ts = setName('Window-1', ts);
  ts = addTabs(
    [
      {
        ...newEmptyTab(),
        ...tabSetId('t1', newEmptyTab()),
        pinned: true,
        title: 'pinned tab',
      },
      {
        ...newEmptyTab(),
        ...tabSetId('t2', newEmptyTab()),
        title: 'normal tab',
      },
    ],
    ts,
  );
  ts = setTabGroups(
    [{ id: 'g1', title: 'work', color: 'blue', tabIds: ['t1', 't2'] }],
    ts,
  );

  const { tabSpaceSavePayload, tabSpace, existTabSavePayloads } =
    convertAndGetTabSpaceSavePayload(ts);

  expect(tabSpaceSavePayload.tabIds).toEqual(['t1', 't2']);
  expect(tabSpaceSavePayload.tabGroups).toEqual([
    { id: 'g1', title: 'work', color: 'blue', tabIds: ['t1', 't2'] },
  ]);
  // pinned survives the trip through the database, on both tabs
  const byId = Object.fromEntries(
    existTabSavePayloads.map((t) => [t.id, t.pinned]),
  );
  expect(byId).toEqual({ t1: true, t2: false });
  expect(tabSpace.tabGroups).toHaveLength(1);
});

test('a tabverse saved before groups existed loads with an empty list', () => {
  const legacy = {
    id: 'ts-old',
    name: 'Window-2',
    tabIds: ['t1'],
    version: 8,
    createdAt: 1,
    updatedAt: 2,
  } as any;
  expect(fromSavedDataWithoutTabs(legacy).tabGroups).toEqual([]);
});

/*
 * Regression: a tab group hint records the tab ids it saw at capture time, but
 * the first save strips the '~' from every tab id. If membership is not
 * remapped at the same time, the hint points at tabs that no longer exist, the
 * group silently stops matching, and the tabs render as unrelated entries.
 */
test('saving remaps group membership onto the saved tab ids', () => {
  let ts = newEmptyTabSpace();
  ts = setId('ts1', ts);
  ts = setName('Window-1', ts);
  ts = addTabs(
    [
      { ...newEmptyTab(), ...tabSetId('~t1', newEmptyTab()), title: 'one' },
      { ...newEmptyTab(), ...tabSetId('~t2', newEmptyTab()), title: 'two' },
    ],
    ts,
  );
  ts = setTabGroups(
    [{ id: 'g1', title: 'work', color: 'blue', tabIds: ['~t1', '~t2'] }],
    ts,
  );

  const { tabSpace, tabSpaceSavePayload } =
    convertAndGetTabSpaceSavePayload(ts);

  // the tabs have been renamed ...
  expect(tabSpace.tabs.map((t) => t.id).toArray()).toEqual(['t1', 't2']);
  // ... and the group followed them
  expect(tabSpace.tabGroups).toEqual([
    { id: 'g1', title: 'work', color: 'blue', tabIds: ['t1', 't2'] },
  ]);
  expect(tabSpaceSavePayload.tabGroups).toEqual(tabSpace.tabGroups);
});

test('group membership for tabs that are gone is dropped, empty groups with it', () => {
  let ts = newEmptyTabSpace();
  ts = setId('ts2', ts);
  ts = addTabs([{ ...newEmptyTab(), ...tabSetId('~t1', newEmptyTab()) }], ts);
  ts = setTabGroups(
    [
      { id: 'g1', title: 'gone', color: 'red', tabIds: ['~deleted'] },
      { id: 'g2', title: 'kept', color: 'green', tabIds: ['~t1'] },
    ],
    ts,
  );

  const { tabSpace } = convertAndGetTabSpaceSavePayload(ts);

  expect(tabSpace.tabGroups).toEqual([
    { id: 'g2', title: 'kept', color: 'green', tabIds: ['t1'] },
  ]);
});
