import { dbAuditor, saveSession } from '../sessionSaver';
import {
  loadSavedSessionsAsGroups,
  loadSavedSessionsForDisplay,
} from '../sessionStore';
import {
  tabData1,
  tabData2,
  tabData3,
} from '../../tabSpace/__tests__/common.test';

import { getMockChrome } from '../../../dev/chromeMock';
import { getNewId } from '../../common';

test('dbAuditor', async () => {
  const tag1 = getNewId();
  const time1 = Date.now() - 1000;
  const tag2 = getNewId();
  const time2 = time1 - 100;
  const tag3 = getNewId();
  const time3 = time2 - 100;

  const mockChrome = getMockChrome();
  const w1 = mockChrome.addWindow();
  const w2 = mockChrome.addWindow();
  const t1 = mockChrome.insertTabFromData(tabData1, w1.id);
  const t2 = mockChrome.insertTabFromData(tabData2, w1.id);
  const t3 = mockChrome.insertTabFromData(tabData1, w1.id);
  const t4 = mockChrome.insertTabFromData(tabData2, w2.id);

  const s1 = await saveSession(tag1, time1);
  const s2 = await saveSession(tag2, time2);

  const t5 = mockChrome.insertTabFromData(tabData3, w1.id);
  const s3 = await saveSession(tag1, time1);
  const s4 = await saveSession(tag2, time2);
  const s5 = await saveSession(tag3, time3);

  const savedSessionGroups1 = await loadSavedSessionsAsGroups();
  expect(savedSessionGroups1).toEqual([
    { tag: tag1, sessions: [s3, s1] },
    { tag: tag2, sessions: [s4, s2] },
    { tag: tag3, sessions: [s5] },
  ]);

  const logs = [];
  await dbAuditor(logs);

  const savedSessionGroups2 = await loadSavedSessionsAsGroups();
  expect(savedSessionGroups2).toEqual([
    { tag: tag1, sessions: [s3, s1] },
    { tag: tag2, sessions: [s4] },
  ]);

  const displaySavedSessionGroups = await loadSavedSessionsForDisplay();
  expect(displaySavedSessionGroups).toEqual([
    { tag: tag1, sessions: [s3, s1], tabSpaceMap: {} },
    { tag: tag2, sessions: [s4], tabSpaceMap: {} },
  ]);
});
