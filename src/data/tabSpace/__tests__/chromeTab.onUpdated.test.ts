import { $tabSpace } from '../store';
import { findTabByChromeTabId } from '../TabSpace';
import {
  getTabSpaceChromeTabIds,
  setupMockChromeAndTabSpaceWithMonitoring,
} from './common.test';
import { querySavedTabSpaceById, saveCurrentTabSpace } from '../util';
import { resetTestDb } from '../../../dev/dbImplTest';
import { TabSavePayload } from '../Tab';

/** The saved row of the tab that currently lives on `chromeTabId`. */
function savedTabOf(chromeTabId: number): Promise<TabSavePayload | undefined> {
  const tabId = findTabByChromeTabId(chromeTabId, $tabSpace.getState())?.id;
  return querySavedTabSpaceById($tabSpace.getState().id).then((tabSpace) =>
    tabSpace.tabs.find((tab) => tab.id === tabId),
  );
}

test('normal', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, tst1 } =
    await setupMockChromeAndTabSpaceWithMonitoring();

  mockChrome.setActiveTab(t2.id);
  const changedTitle = t2.title + 'changed';
  mockChrome.updateTab(t2.id, { title: changedTitle });
  await mockChrome.flushMessages();
  expect(getTabSpaceChromeTabIds()).toEqual([t1.id, t2.id, t3.id]);
  expect(findTabByChromeTabId(t2.id, $tabSpace.getState()).title).toEqual(
    changedTitle,
  );
});

test('title only change does not auto save the tabverse', async () => {
  const { mockChrome, t1 } = await setupMockChromeAndTabSpaceWithMonitoring();
  await saveCurrentTabSpace();
  const savedBefore = await savedTabOf(t1.id);

  mockChrome.updateTab(t1.id, { title: 'a new title' });
  await mockChrome.flushMessages();

  // the store takes the new title right away ...
  expect(findTabByChromeTabId(t1.id, $tabSpace.getState()).title).toEqual(
    'a new title',
  );
  // ... but the saved tabverse is not rewritten for it
  expect((await savedTabOf(t1.id)).title).toEqual(savedBefore.title);
  await resetTestDb();
});

test('favicon only change does not auto save the tabverse', async () => {
  const { mockChrome, t1 } = await setupMockChromeAndTabSpaceWithMonitoring();
  await saveCurrentTabSpace();
  const savedBefore = await savedTabOf(t1.id);

  const changedFavIconUrl = savedBefore.favIconUrl + '?v=2';
  mockChrome.updateTab(t1.id, { favIconUrl: changedFavIconUrl });
  await mockChrome.flushMessages();

  expect(findTabByChromeTabId(t1.id, $tabSpace.getState()).favIconUrl).toEqual(
    changedFavIconUrl,
  );
  expect((await savedTabOf(t1.id)).favIconUrl).toEqual(savedBefore.favIconUrl);
  await resetTestDb();
});

test('url change auto saves the tabverse, and takes the pending title with it', async () => {
  const { mockChrome, t1 } = await setupMockChromeAndTabSpaceWithMonitoring();
  await saveCurrentTabSpace();

  // not saved on its own ...
  mockChrome.updateTab(t1.id, { title: 'a new title' });
  await mockChrome.flushMessages();

  // ... but a url change saves, and the save reads the current store state
  const changedUrl = 'https://www.test.com/page?q=1#hash';
  mockChrome.updateTab(t1.id, { url: changedUrl });
  await mockChrome.flushMessages();

  const savedAfter = await savedTabOf(t1.id);
  expect(savedAfter.url).toEqual(changedUrl);
  expect(savedAfter.title).toEqual('a new title');
  await resetTestDb();
});
