import { getSavedId, getUnsavedNewId, isIdNotSaved } from '../../common';

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
  expect(isIdNotSaved(t.id)).toBeTruthy();
  expect(t.createdAt).toBe(-1);
  expect(t.updatedAt).toBe(-1);
  expect(t.version).toBe(TABSPACE_DB_VERSION);
});

test('convertAndGetSavePayload', () => {
  const t = setTabSpaceId(
    getUnsavedNewId(),
    fromLiveTab({ chromeTabId: 1000, chromeWindowId: 1001 }),
  );
  expect(t.chromeTabId).toBe(1000);
  expect(t.chromeWindowId).toBe(1001);
  const { tab, savedTab } = convertAndGetTabSavePayload(t, getSavedId(t.id));
  expect(isIdNotSaved(savedTab.id)).toBeFalsy();
  expect(isIdNotSaved(tab.id)).toBeFalsy();
  expect(isIdNotSaved(tab.tabSpaceId)).toBeFalsy();
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
