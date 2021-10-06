import { ChromeSession, IChromeSessionSavePayload } from '../session';
import {
  tabData1,
  tabData2,
  tabData3,
} from '../../tabSpace/__tests__/common.test';

import { db } from '../../../store/db';
import { getMockChrome } from '../../../dev/chromeMock';
import { getNewId } from '../../common';
import { saveSession } from '../sessionSaver';

test('saveSession', async () => {
  const tag1 = getNewId();
  const time1 = Date.now() - 1000;
  const time11 = time1 + 10;
  const time12 = time1 + 20;
  const time13 = time1 + 30;
  const tag2 = getNewId();
  const time2 = time1 + 100;
  const tag3 = getNewId();
  const time3 = time2 + 100;

  const mockChrome = getMockChrome();
  const w1 = mockChrome.addWindow();
  const w2 = mockChrome.addWindow();
  const t1 = mockChrome.insertTabFromData(tabData1, w1.id);
  const t2 = mockChrome.insertTabFromData(tabData2, w1.id);
  const t3 = mockChrome.insertTabFromData(tabData1, w1.id);
  const t4 = mockChrome.insertTabFromData(tabData2, w2.id);

  await saveSession(tag1, time1);
  let savedSessions = await db
    .table<IChromeSessionSavePayload>(ChromeSession.DB_TABLE_NAME)
    .orderBy('updatedAt')
    .reverse()
    .filter((savedSession) => savedSession.tag === tag1)
    .toArray();
  expect(savedSessions.length).toEqual(1);

  const t5 = mockChrome.insertTabFromData(tabData3, w1.id);
  await saveSession(tag1, time1);
  savedSessions = await db
    .table<IChromeSessionSavePayload>(ChromeSession.DB_TABLE_NAME)
    .orderBy('updatedAt')
    .reverse()
    .filter((savedSession) => savedSession.tag === tag1)
    .toArray();
  expect(savedSessions.length).toEqual(2);

  const t6 = mockChrome.insertTabFromData(tabData1, w2.id);
  await saveSession(tag1, time1);
  savedSessions = await db
    .table<IChromeSessionSavePayload>(ChromeSession.DB_TABLE_NAME)
    .orderBy('updatedAt')
    .reverse()
    .filter((savedSession) => savedSession.tag === tag1)
    .toArray();
  expect(savedSessions.length).toEqual(2);
  expect(savedSessions[0].windows.map((window) => window.tabIds)).toEqual([
    [101, 102, 103, 105],
    [104, 106],
  ]);
  expect(savedSessions[1].windows.map((window) => window.tabIds)).toEqual([
    [101, 102, 103, 105],
    [104],
  ]);
});
