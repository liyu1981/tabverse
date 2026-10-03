import {
  deleteSavedTabSpace,
  querySavedTabSpace,
  querySavedTabSpaceById,
  saveCurrentTabSpace,
} from '../../tabSpace/util';
import {
  initMockChrome,
  tsTabData1,
} from '../../tabSpace/__tests__/common.test';

import { $tabSpace, tabSpaceStoreApi } from '../../tabSpace/store';
import { $tabSpaceQuery, tabSpaceQueryStoreApi } from '../store';
import { TABSPACE_DB_TABLE_NAME } from '../../tabSpace/TabSpace';
import { TAB_DB_TABLE_NAME } from '../../tabSpace/Tab';
import { Query } from '../../search';
import { isTabSpaceOpened } from '../TabSpaceQuery';
import { TABSPACE_MANAGER_TAB_URL_PREFIX } from '../../../global';
import { db } from '../../../storage/db';
import { getNewId } from '../../common';
import { QUERY_PAGE_LIMIT_DEFAULT } from '../../../storage/db';
import { findTabByChromeTabId } from '../../tabSpace/TabSpace';
import { omit } from 'lodash';
import { resetTestDb } from '../../../dev/dbImplTest';
import { tabSpaceBootstrap } from '../../tabSpaceBootstrap';

export async function initTabSpaceData() {
  // storeManagerBootstrap();
  const { mockChrome, w1, w2, t1, t2, t3, t4 } = initMockChrome();
  const tst1 = mockChrome.insertTabFromData(tsTabData1, w1.id, 0);
  await mockChrome.flushMessages();
  await tabSpaceBootstrap(tst1.id, tst1.windowId, getNewId());
  return { mockChrome, w1, w2, t1, t2, t3, t4, tst1 };
}

export async function testWithDb(description: string, f: () => Promise<void>) {
  await f();
  await resetTestDb();
}

test('tabSpaceStore', async () => {
  await testWithDb('saveCurrentTabSpace', async () => {
    const { mockChrome, w1, w2, t1, t2, t3, t4, tst1 } =
      await initTabSpaceData();
    await saveCurrentTabSpace();
    const tabSpace2 = await querySavedTabSpaceById($tabSpace.getState().id);
    expect(omit(tabSpace2, ['chromeTabId', 'chromeWindowId', 'tabs'])).toEqual(
      omit($tabSpace.getState(), ['chromeTabId', 'chromeWindowId', 'tabs']),
    );

    const changedTitle = t1.title + 'changed';
    mockChrome.updateTab(t1.id, { title: changedTitle });
    await mockChrome.flushMessages();
    const tab1 = findTabByChromeTabId(t1.id, $tabSpace.getState());
    // a title on its own no longer auto saves the tabverse (see
    // chromeTab.ts), so save explicitly to get at the new title
    await saveCurrentTabSpace();
    const savedTabSpace1 = await querySavedTabSpaceById(
      $tabSpace.getState().id,
    );
    const savedTab = savedTabSpace1.tabs.find(
      (savedTab) => savedTab.id === tab1.id,
    );
    expect(savedTab.title).toEqual(changedTitle);

    const savedTabSpaces1 = await querySavedTabSpace({
      anyOf: [$tabSpace.getState().id],
    });
    expect(savedTabSpaces1.length).toEqual(1);
    const savedTabSpaces2 = await querySavedTabSpace({
      noneOf: [$tabSpace.getState().id],
    });
    expect(savedTabSpaces2.length).toEqual(0);
    const savedTabSpaces3 = await querySavedTabSpace({
      anyOf: [$tabSpace.getState().id],
      pageStart: 1,
      pageLimit: QUERY_PAGE_LIMIT_DEFAULT,
    });
    expect(savedTabSpaces3.length).toEqual(0);

    await deleteSavedTabSpace($tabSpace.getState().id);
    const savedTabSpaces = await querySavedTabSpace();
    expect(savedTabSpaces.length).toEqual(0);
  });
});

test('searching pages the result and reports the backend', async () => {
  await testWithDb('search', async () => {
    await initTabSpaceData();
    // three saved tabverses, one of which matches
    const saved = [
      { id: 'ts-a', name: 'Alpha', tabIds: ['ta'] },
      { id: 'ts-b', name: 'Beta', tabIds: ['tb'] },
      { id: 'ts-c', name: 'Gamma', tabIds: ['tc'] },
    ];
    await db.table(TABSPACE_DB_TABLE_NAME).bulkPut(
      saved.map((row) => ({
        ...row,
        version: 10,
        createdAt: 1,
        updatedAt: 1,
      })),
    );
    await db.table(TAB_DB_TABLE_NAME).bulkPut(
      saved.map((row) => ({
        id: row.tabIds[0],
        tabSpaceId: row.id,
        title: `${row.name} page`,
        url: `https://example.com/${row.id}`,
        favIconUrl: '',
        pinned: false,
        suspended: false,
        version: 10,
        createdAt: 1,
        updatedAt: 1,
      })),
    );

    // no pairing config in this environment, so the local scan answers
    tabSpaceQueryStoreApi.setQuery(
      new Query({
        andQueries: [{ scope: {}, terms: ['gamma'] }],
      }),
    );
    await tabSpaceQueryStoreApi.reload();

    const state = $tabSpaceQuery.getState();
    expect(state.savedTabSpaces.map((t) => t.id)).toEqual(['ts-c']);
    expect(state.searchBackend).toEqual('local');
    expect(state.searchUnknownTabSpaceIds).toEqual([]);
    expect(state.totalPageCount).toEqual(1);
    // the result is a tabverse with its tabs, like the browse list
    expect(state.savedTabSpaces[0].tabs.size).toEqual(1);

    // browsing again clears the search state
    tabSpaceQueryStoreApi.setQuery(new Query({ andQueries: [] }));
    await tabSpaceQueryStoreApi.reload();
    expect($tabSpaceQuery.getState().searchBackend).toEqual(null);
  });
});

test('the opened list is every tabverse open in this profile, not only this window', async () => {
  await testWithDb('openedSavedTabSpaces spans windows', async () => {
    const { mockChrome, w1, w2 } = initMockChrome();
    const managerUrl = (tvid: string) =>
      `${TABSPACE_MANAGER_TAB_URL_PREFIX}?op=new&tvid=${tvid}`;

    // this page's own tabverse, in w1
    tabSpaceStoreApi.reset({ chromeTabId: 1, chromeWindowId: w1.id });
    const self = $tabSpace.getState();
    mockChrome.insertTabFromData(
      {
        title: 'Tabverse',
        url: managerUrl(self.id),
        favIconUrl: '',
        pinned: true,
      },
      w1.id,
    );
    // a tabverse open in the other window, with a saved row
    await db.table(TABSPACE_DB_TABLE_NAME).put({
      id: 'ts-other',
      name: 'Recipes for the week',
      tabIds: [],
      tabGroups: [],
      version: 10,
      createdAt: 1,
      updatedAt: 2,
    });
    mockChrome.insertTabFromData(
      {
        title: 'Tabverse',
        url: managerUrl('ts-other'),
        favIconUrl: '',
        pinned: true,
      },
      w2.id,
    );

    await tabSpaceQueryStoreApi.reload();

    const opened = $tabSpaceQuery.getState().openedSavedTabSpaces;
    expect(opened.map((o) => o.id).sort()).toEqual(
      ['ts-other', self.id].sort(),
    );
    // the neighbour carries its own window and tab, which is what Switch needs
    const other = opened.find((o) => o.id === 'ts-other');
    expect(other?.chromeWindowId).toEqual(w2.id);
    // and isTabSpaceOpened - which decides Switch vs Load - now says yes
    expect(isTabSpaceOpened('ts-other', $tabSpaceQuery.getState())).toBe(true);
    expect(isTabSpaceOpened('ts-closed', $tabSpaceQuery.getState())).toBe(
      false,
    );
  });
});

test('a tabverse open in a window whose row is not here yet is still listed', async () => {
  await testWithDb('opened without a saved row', async () => {
    const { mockChrome, w1, w2 } = initMockChrome();
    tabSpaceStoreApi.reset({ chromeTabId: 1, chromeWindowId: w1.id });
    const self = $tabSpace.getState();
    mockChrome.insertTabFromData(
      {
        title: 'Tabverse',
        url: `${TABSPACE_MANAGER_TAB_URL_PREFIX}?op=new&tvid=${self.id}`,
        favIconUrl: '',
        pinned: true,
      },
      w1.id,
    );
    // no SavedTabSpace row for this one: its window opened a moment ago
    mockChrome.insertTabFromData(
      {
        title: 'Tabverse',
        url: `${TABSPACE_MANAGER_TAB_URL_PREFIX}?op=new&tvid=ts-just-opened`,
        favIconUrl: '',
        pinned: true,
      },
      w2.id,
    );

    await tabSpaceQueryStoreApi.reload();

    const opened = $tabSpaceQuery.getState().openedSavedTabSpaces;
    // present, not dropped: "is it open" does not depend on having read its row
    expect(opened.map((o) => o.id)).toContain('ts-just-opened');
  });
});
