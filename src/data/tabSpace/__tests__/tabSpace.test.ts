import { TabSpace } from '../tabSpace';
import { getSavedId, isIdNotSaved } from '../../common';
import { Tab } from '../tab';
import { TABSPACE_DB_VERSION } from '../../../global';

test('constructor', () => {
  const ts = new TabSpace();
  expect(ts.name).toEqual('');
  expect(ts.chromeTabId).toBe(-1);
  expect(ts.chromeWindowId).toBe(-1);
  expect(ts.needAutoSave()).toBeFalsy();

  const ts5 = new TabSpace(300, 301, 'testts5');
  expect(ts5.id).toBe('testts5');
  expect(ts5.name).toBe('Window-301');
  expect(ts5.toJSON().chromeTabId).toBe(300);
  expect(ts5.toJSON().chromeWindowId).toBe(301);

  const ts6 = new TabSpace();
  expect(ts6.toJSON().chromeTabId).toBe(-1);
  expect(ts6.toJSON().chromeWindowId).toBe(-1);

  const ts7 = new TabSpace(400, 401, 'testts7');
  ts7.reset(null, null, 'testts7');
  expect(ts7.chromeTabId).toBe(-1);
  expect(ts7.chromeWindowId).toBe(-1);
  expect(ts7.id).toBe('testts7');
});

test('tab is immutable', () => {
  const ts = new TabSpace();
  const t1 = new Tab();
  t1.chromeTabId = 100;
  t1.chromeWindowId = 1000;
  ts.addTab(t1);
  const addedT1 = ts.findTabById(t1.id);
  expect(() => {
    addedT1.title = 'something';
  }).toThrowError();
});

test('findTabById/findTabByChromeTabId', () => {
  const ts = new TabSpace();
  const t1 = new Tab();
  t1.chromeTabId = 100;
  t1.chromeWindowId = 1000;
  const t2 = new Tab();
  t2.chromeTabId = 101;
  t2.chromeWindowId = 1000;
  ts.addTab(t1);
  ts.addTab(t2);
  expect(ts.findTabById(t1.id).chromeTabId).toEqual(t1.chromeTabId);
  expect(ts.findTabByChromeTabId(t2.chromeTabId).id).toEqual(t2.id);
});

test('addTab/addTabs', () => {
  const ts = new TabSpace();
  const t1 = new Tab();
  const t2 = new Tab();
  const t3 = new Tab();
  const t4 = new Tab();
  ts.addTab(t1);
  ts.addTab(t2, -1);
  ts.addTab(t3, 2);
  ts.addTab(t4, 1);
  expect(ts.tabIds).toEqual([t2.id, t4.id, t1.id, t3.id]);
  ts.tabs.forEach((tab) => {
    expect(tab.tabSpaceId).toEqual(ts.id);
  });

  const t5 = new Tab();
  const t6 = new Tab();
  ts.addTabs([t5, t6]);
  expect(ts.tabIds).toEqual([t2.id, t4.id, t1.id, t3.id, t5.id, t6.id]);
});

test('clone/toJSON/fromJSON', () => {
  const ts = new TabSpace();
  const t1 = new Tab();
  ts.addTab(t1);

  const ts2 = ts.clone();
  expect(ts2.tabIds.length).toBe(1);
  expect(ts2.tabIds).toEqual([t1.id]);
  expect(ts.isEqual(ts2)).toBeTruthy();

  const ts3 = TabSpace.fromJSON(ts.toJSON());
  expect(ts.isEqual(ts3)).toBeTruthy();
});

test('updateTab', () => {
  const ts = new TabSpace();
  const t1 = new Tab();
  ts.addTab(t1);

  const addedT1 = ts.findTabById(t1.id);
  expect(ts.updateTab(addedT1)).toBeFalsy();

  const t2 = addedT1.clone();
  const changedTitle = t2.title + 'changed';
  t2.title = changedTitle;
  expect(ts.updateTab(t2)).toBeTruthy();
  expect(ts.findTabById(t2.id).title).toEqual(changedTitle);

  const t3 = new Tab();
  const t4 = new Tab();
  ts.replaceTabs;
});

test('removeTab/removeTabById/removeTabByChromeTabId', () => {
  const ts = new TabSpace();
  const t1 = new Tab();
  t1.chromeTabId = 100;
  t1.chromeWindowId = 1000;
  const t2 = new Tab();
  t2.chromeTabId = 101;
  t2.chromeWindowId = 1000;
  const t3 = new Tab();
  t3.chromeTabId = 102;
  t3.chromeWindowId = 1000;
  ts.addTab(t1);
  ts.addTab(t2);
  ts.addTab(t3);

  ts.removeTabById('888');
  expect(ts.tabIds).toEqual([t1.id, t2.id, t3.id]);
  ts.removeTabById(t1.id);
  expect(ts.tabIds).toEqual([t2.id, t3.id]);
  ts.removeTabByChromeTabId(t2.chromeTabId);
  expect(ts.tabIds).toEqual([t3.id]);
  ts.removeTab(t3);
  expect(ts.tabIds.length).toEqual(0);
});

test('replaceTab/replaceTabs', () => {
  const ts = new TabSpace();
  const t1 = new Tab();
  const t2 = new Tab();
  const t3 = new Tab();
  ts.addTab(t1);
  ts.addTab(t2);
  ts.addTab(t3);
  const t4 = new Tab();

  ts.replaceTab(t2.id, t4.id, t4);
  expect(ts.tabIds).toEqual([t1.id, t4.id, t3.id]);
  ts.replaceTab('999', t2.id, t2);
  expect(ts.tabIds).toEqual([t1.id, t4.id, t3.id, t2.id]);

  ts.replaceTabs([t3, t2, t4]);
  expect(ts.tabIds).toEqual([t3.id, t2.id, t4.id]);
});

test('update', () => {
  const ts = new TabSpace();
  ts.update({ name: 'test' });
  expect(ts.name).toEqual('test');
});

test('convertAndGetSavePayload', () => {
  const ts = new TabSpace();
  const t1 = new Tab();
  ts.addTab(t1);
  const {
    tabSpaceSavePayload,
    isNewTabSpace,
    newTabSavePayloads,
    existTabSavePayloads,
  } = ts.convertAndGetSavePayload();
  expect(tabSpaceSavePayload.tabIds).toEqual([getSavedId(t1.id)]);
  expect(isNewTabSpace).toBeTruthy();
  expect(newTabSavePayloads[0].id).toEqual(getSavedId(t1.id));
  expect(existTabSavePayloads.length).toEqual(0);

  const ts4 = TabSpace.fromSavedDataWithoutTabs(tabSpaceSavePayload);
  expect(isIdNotSaved(ts4.id)).toBeFalsy();
  expect(ts4.tabs.size).toEqual(0);
});

test('reset', () => {
  const ts3 = new TabSpace();
  ts3.reset(100, 101);
  expect(isIdNotSaved(ts3.id)).toBeTruthy();
  expect(ts3.chromeTabId).toBe(100);
  expect(ts3.chromeWindowId).toBe(101);
  ts3.setChromeTabAndWindowId(200, 201);
  expect(ts3.chromeTabId).toBe(200);
  expect(ts3.chromeWindowId).toBe(201);
  expect(ts3.name).not.toBe('tabverse-201');
  ts3.setChromeTabAndWindowId(200, 201, true);
  expect(ts3.name).toBe('tabverse-201');

  const ts7 = new TabSpace(400, 401, 'testts7');
  ts7.reset(null, null, 'testts7');
  expect(ts7.chromeTabId).toBe(-1);
  expect(ts7.chromeWindowId).toBe(-1);
  expect(ts7.id).toBe('testts7');
});

test('toTabSpaceStub', () => {
  const ts = new TabSpace();
  ts.id = '888';
  const stub = ts.toTabSpaceStub();
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
