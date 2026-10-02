import { getNewId } from '../../common';

import { TABSPACE_DB_VERSION } from '../../../global';
import {
  newEmptyTab,
  fromLiveTab,
  setTabSpaceId,
  convertAndGetTabSavePayload,
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
