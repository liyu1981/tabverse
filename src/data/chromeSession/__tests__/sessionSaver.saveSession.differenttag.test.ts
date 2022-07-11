import {
  CHROMESESSION_DB_TABLE_NAME,
  ChromeSessionSavePayload,
} from '../ChromeSession';
import {
  tabData1,
  tabData2,
  tabData3,
} from '../../tabSpace/__tests__/common.test';

import { db } from '../../../storage/db';
import { getMockChrome } from '../../../dev/chromeMock';
import { getNewId } from '../../common';
import { saveSession } from '../sessionSaver';

async function getSavedSessions() {
  return await db
    .table<ChromeSessionSavePayload>(CHROMESESSION_DB_TABLE_NAME)
    .orderBy('updatedAt')
    .reverse()
    .toArray();
}

test('saveSession different tag', async () => {
  const tag1 = getNewId();
  const time1 = Date.now() - 1000;
  const time11 = time1 + 10;
  const time12 = time1 + 20;
  const time13 = time1 + 30;
  const tag2 = getNewId();
  const time2 = time1 + 100;
  const time21 = time2 + 10;
  const tag3 = getNewId();
  const time3 = time2 + 100;
  const time31 = time3 + 10;

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
  expect(savedSessions[0].windows[0].tabIds).toEqual([t1.id, t2.id, t3.id]);
  expect(savedSessions[0].windows[1].tabIds).toEqual([t4.id]);

  const t5 = mockChrome.insertTabFromData(tabData3, w1.id);
  await saveSession(tag1, time11);
  savedSessions = await getSavedSessions();
  expect(savedSessions.length).toEqual(2);
  expect(savedSessions[0].windows[0].tabIds).toEqual([
    t1.id,
    t2.id,
    t3.id,
    t5.id,
  ]);
  expect(savedSessions[0].windows[1].tabIds).toEqual([t4.id]);
  expect(savedSessions[1].windows[0].tabIds).toEqual([t1.id, t2.id, t3.id]);
  expect(savedSessions[1].windows[1].tabIds).toEqual([t4.id]);

  const t6 = mockChrome.insertTabFromData(tabData1, w2.id);
  await saveSession(tag2, time2);
  savedSessions = await getSavedSessions();
  expect(savedSessions.length).toEqual(3);
  expect(savedSessions.map((ss) => ss.tag)).toEqual([tag2, tag1, tag1]);
  expect(savedSessions[0].windows[0].tabIds).toEqual([
    t1.id,
    t2.id,
    t3.id,
    t5.id,
  ]);
  expect(savedSessions[0].windows[1].tabIds).toEqual([t4.id, t6.id]);

  const t7 = mockChrome.insertTabFromData(tabData2, w1.id);
  await saveSession(tag2, time21);
  savedSessions = await getSavedSessions();
  expect(savedSessions.length).toEqual(4);
  expect(savedSessions.map((ss) => ss.tag)).toEqual([tag2, tag2, tag1, tag1]);
  expect(savedSessions[0].windows[0].tabIds).toEqual([
    t1.id,
    t2.id,
    t3.id,
    t5.id,
    t7.id,
  ]);
  expect(savedSessions[0].windows[1].tabIds).toEqual([t4.id, t6.id]);
  expect(savedSessions[1].windows[0].tabIds).toEqual([
    t1.id,
    t2.id,
    t3.id,
    t5.id,
  ]);
  expect(savedSessions[1].windows[1].tabIds).toEqual([t4.id, t6.id]);

  const t8 = mockChrome.insertTabFromData(tabData3, w1.id);
  await saveSession(tag3, time3);
  savedSessions = await getSavedSessions();
  expect(savedSessions.length).toEqual(3);
  expect(savedSessions.map((ss) => ss.tag)).toEqual([tag3, tag2, tag2]);

  const t9 = mockChrome.insertTabFromData(tabData3, w1.id);
  await saveSession(tag3, time31);
  savedSessions = await getSavedSessions();
  expect(savedSessions.length).toEqual(4);
  expect(savedSessions.map((ss) => ss.tag)).toEqual([tag3, tag3, tag2, tag2]);

  // console.log(
  //   savedSessions.map((savedSession) =>
  //     JSON.stringify(savedSession.windows, null, 2),
  //   ),
  // );
});
