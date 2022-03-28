import {
  ChromeSessionSavePayload,
  CHROMESESSION_DB_TABLE_NAME,
} from '../ChromeSession';

import { db } from '../../../store/db';
import { getMockChrome } from '../../../dev/chromeMock';
import { getNewId } from '../../common';
import { saveSession } from '../sessionSaver';
import {
  tabData1,
  tabData2,
  tabData3,
} from '../../tabSpace/__tests__/common.test';

async function getSavedSessions() {
  return await db
    .table<ChromeSessionSavePayload>(CHROMESESSION_DB_TABLE_NAME)
    .orderBy('updatedAt')
    .reverse()
    .toArray();
}

test('saveSession same tag', async () => {
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
  let savedSessions = await getSavedSessions();
  expect(savedSessions.length).toEqual(1);
  // console.log(
  //   savedSessions.map((savedSession) =>
  //     JSON.stringify(savedSession.windows, null, 2),
  //   ),
  // );

  const t5 = mockChrome.insertTabFromData(tabData3, w1.id);
  await saveSession(tag1, time1);
  savedSessions = await getSavedSessions();
  expect(savedSessions.length).toEqual(2);
  // console.log(
  //   savedSessions.map((savedSession) =>
  //     JSON.stringify(savedSession.windows, null, 2),
  //   ),
  // );

  const t6 = mockChrome.insertTabFromData(tabData1, w2.id);
  await saveSession(tag1, time1);
  savedSessions = await getSavedSessions();
  expect(savedSessions.length).toEqual(3);
  // console.log(
  //   savedSessions.map((savedSession) =>
  //     JSON.stringify(savedSession.windows, null, 2),
  //   ),
  // );

  const t7 = mockChrome.insertTabFromData(tabData2, w1.id);
  await saveSession(tag1, time1);
  savedSessions = await getSavedSessions();
  expect(savedSessions.length).toEqual(3);
  // console.log(
  //   savedSessions.map((savedSession) =>
  //     JSON.stringify(savedSession.windows, null, 2),
  //   ),
  // );
  expect(savedSessions[0].windows.map((w) => w.tabIds)).toEqual([
    [101, 102, 103, 105, 107],
    [104, 106],
  ]);
});
