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
    .orderBy('createdAt')
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
  await saveSession(tag1, time12);
  savedSessions = await getSavedSessions();
  // console.log(
  //   savedSessions.map((savedSession) =>
  //     JSON.stringify(savedSession.windows, null, 2),
  //   ),
  // );
  expect(savedSessions.length).toEqual(2);
  expect(savedSessions[0].windows[0].tabIds).toEqual([
    t1.id,
    t2.id,
    t3.id,
    t5.id,
  ]);
  expect(savedSessions[0].windows[1].tabIds).toEqual([t4.id, t6.id]);
  expect(savedSessions[1].windows[0].tabIds).toEqual([
    t1.id,
    t2.id,
    t3.id,
    t5.id,
  ]);
  expect(savedSessions[1].windows[1].tabIds).toEqual([t4.id]);
});
