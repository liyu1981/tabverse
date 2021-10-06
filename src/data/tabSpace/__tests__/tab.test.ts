import { TABSPACE_DB_VERSION } from '../../../global';
import { Tab } from '../tab';
import { isIdNotSaved } from '../../common';

test('constructor', () => {
  const t = new Tab();
  expect(isIdNotSaved(t.id)).toBeTruthy();
  expect(t.createdAt).toBe(-1);
  expect(t.updatedAt).toBe(-1);
  expect(t.version).toBe(TABSPACE_DB_VERSION);
});

test('convertAndGetSavePayload', () => {
  const t = Tab.fromILiveTab({ chromeTabId: 1000, chromeWindowId: 1001 });
  expect(t.chromeTabId).toBe(1000);
  expect(t.chromeWindowId).toBe(1001);
  const [savedTab, savePayload] = t.convertAndGetSavePayload();
  expect(isIdNotSaved(savePayload.id)).toBeFalsy();
  expect(savePayload.createdAt).toBeGreaterThan(0);
  expect(savePayload.updatedAt).toBeGreaterThan(0);
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
  const t = Tab.fromSavedData(savedData);
  Object.keys(savedData).forEach((key) => {
    expect(t[key]).toEqual(savedData[key]);
  });
});
