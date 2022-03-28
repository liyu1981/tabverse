import { getSavedId, isIdNotSaved } from '../../common';

import { TABSPACE_DB_VERSION } from '../../../global';
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
  setName,
  toTabSpaceStub,
  updateTab,
  updateTabSpace,
} from '../TabSpace';
import {
  setChromeTabId as tabSetChromeTabId,
  setChromeWindowId as tabSetChromeWindowId,
} from '../Tab';
import { newEmptyTab } from '../Tab';

test('constructor', () => {
  const ts = newEmptyTabSpace();
  expect(ts.name).toEqual('');
  expect(ts.chromeTabId).toBe(-1);
  expect(ts.chromeWindowId).toBe(-1);
  expect(needAutoSave(ts)).toBeFalsy();

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

test('toTabSpaceStub', () => {
  let ts = newEmptyTabSpace();
  ts = updateTabSpace({ id: '888' }, ts);
  const stub = toTabSpaceStub(ts);
  expect(stub).toEqual({
    chromeTabId: -1,
    chromeWindowId: -1,
    createdAt: -1,
    id: '888',
    name: '',
    updatedAt: -1,
    version: TABSPACE_DB_VERSION,
  });
});
