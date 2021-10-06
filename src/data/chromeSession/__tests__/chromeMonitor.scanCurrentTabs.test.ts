import { ChromeSession, NotTabSpaceTabId } from '../session';
import {
  getTabSpaceData,
  bootstrap as tabSpaceBootstrap,
} from '../../tabSpace/bootstrap';
import {
  tabData1,
  tabData2,
  tabData3,
  tsTabData1,
} from '../../tabSpace/__tests__/common.test';

import { List } from 'immutable';
import { getMockChrome } from '../../../dev/chromeMock';
import { scanCurrentTabsForTabSpaceManager } from '../chromeScan';
import { bootstrap as storeBootstrap } from '../../../store/bootstrap';

test('scanCurrentTabs', async () => {
  const mockChrome = getMockChrome();
  const window1 = mockChrome.addWindow();
  const tab1 = mockChrome.insertTabFromData(tabData1);
  const tab2 = mockChrome.insertTabFromData(tabData2);
  const window2 = mockChrome.addWindow();
  mockChrome.setCurrentWindow(window2.id);
  const tst1 = mockChrome.insertTabFromData(tsTabData1);
  const tab3 = mockChrome.insertTabFromData(tabData1);
  const tab4 = mockChrome.insertTabFromData(tabData3);
  const session = new ChromeSession();
  storeBootstrap();
  await tabSpaceBootstrap(tst1.id, tst1.windowId);
  await scanCurrentTabsForTabSpaceManager(session);
  expect(session.tabs.map((t) => t.tabId).toArray()).toEqual([
    tab1.id,
    tab2.id,
    tab3.id,
    tab4.id,
  ]);
  expect(session.windows.toArray()).toEqual([
    {
      tabIds: List([tab1.id, tab2.id]),
      tabSpaceId: '',
      tabSpaceTabId: NotTabSpaceTabId,
      windowId: window1.id,
    },
    {
      tabIds: List([tab3.id, tab4.id]),
      tabSpaceId: getTabSpaceData().tabSpace.id,
      tabSpaceTabId: tst1.id,
      windowId: window2.id,
    },
  ]);
});
