import { $allTodo, todoStoreApi } from '../../todo/store';
import { $tabSpace, tabSpaceStoreApi } from '../store';
import { ALLTODO_DB_TABLE_NAME } from '../../todo/AllTodo';
import { ALLNOTE_DB_TABLE_NAME } from '../../note/AllNote';
import { ALLBOOKMARK_DB_TABLE_NAME } from '../../bookmark/AllBookmark';
import { bookmarkStoreApi } from '../../bookmark/store';
import { CLOSED_TAB_DB_TABLE_NAME } from '../../closedTab/ClosedTab';
import { closedTabStoreApi } from '../../closedTab/store';
import { newEmptyAllBookmark } from '../../bookmark/AllBookmark';
import { newEmptyAllClosedTab } from '../../closedTab/AllClosedTab';
import { newEmptyAllNote } from '../../note/AllNote';
import { newEmptyAllTodo, updateTabSpaceId } from '../../todo/AllTodo';
import { newEmptyTodo, setContent } from '../../todo/Todo';
import { noteStoreApi } from '../../note/store';
import { querySavedTabSpaceById } from '../util';
import { resetTestDb } from '../../../dev/dbImplTest';
import { saveAndCloseTabSpace } from '../closeTabSpace';
import { TABSPACE_DB_TABLE_NAME } from '../../tabSpace/TabSpace';
import { TODO_DB_TABLE_NAME } from '../../todo/Todo';
import { db } from '../../../storage/db';
import { getMockChrome } from '../../../dev/chromeMock';

const TABSPACE_ID = 'ts-close-test';

/** A window with a tabverse tab and one ordinary tab, as a tabverse window has. */
function windowWithTabverseTab() {
  const mockChrome = getMockChrome();
  const w1 = mockChrome.addWindow();
  const tabverseTab = mockChrome.insertTabFromData(
    {
      title: 'Tabverse',
      url: 'chrome-extension://x/manager.html',
      favIconUrl: '',
      pinned: true,
    },
    w1.id,
  );
  const otherTab = mockChrome.insertTabFromData(
    {
      title: 'work',
      url: 'https://example.com',
      favIconUrl: '',
      pinned: false,
    },
    w1.id,
  );
  return { mockChrome, w1, tabverseTab, otherTab };
}

beforeEach(async () => {
  await resetTestDb();
  tabSpaceStoreApi.updateTabSpace({ id: TABSPACE_ID });
  // the right side stores are module state and one tabverse at a time
  todoStoreApi.update(newEmptyAllTodo());
  noteStoreApi.update(newEmptyAllNote());
  bookmarkStoreApi.update(newEmptyAllBookmark());
  closedTabStoreApi.update(newEmptyAllClosedTab());
});

test('it saves the tabverse, then closes the tabverse tab', async () => {
  const { mockChrome, w1, tabverseTab, otherTab } = windowWithTabverseTab();
  tabSpaceStoreApi.updateTabSpace({
    id: TABSPACE_ID,
    chromeTabId: tabverseTab.id,
    chromeWindowId: w1.id,
  });

  await saveAndCloseTabSpace();

  // the tabverse is in the database...
  const saved = await querySavedTabSpaceById(TABSPACE_ID);
  expect(saved.id).toEqual(TABSPACE_ID);
  // ...the tabverse tab is gone...
  expect(mockChrome.getTab(tabverseTab.id)).toBeNull();
  // ...and the window's other tabs are untouched: closing a tabverse does not
  // close the window's work
  expect(mockChrome.getTab(otherTab.id)).not.toBeNull();
});

test('a right side tool that was loaded is flushed before the close', async () => {
  const { tabverseTab, w1 } = windowWithTabverseTab();
  tabSpaceStoreApi.updateTabSpace({
    id: TABSPACE_ID,
    chromeTabId: tabverseTab.id,
    chromeWindowId: w1.id,
  });
  // the Todo panel was opened and something was typed: the store holds an edit
  // that the debounced save may not have written yet
  todoStoreApi.update(updateTabSpaceId(TABSPACE_ID, $allTodo.getState()));
  todoStoreApi.addTodo(setContent('buy semolina', newEmptyTodo()));

  await saveAndCloseTabSpace();

  const todos = await db.table(TODO_DB_TABLE_NAME).toArray();
  expect(todos.length).toEqual(1);
  expect(todos[0].content).toEqual('buy semolina');
  expect(todos[0].tabSpaceId).toEqual(TABSPACE_ID);
  expect(
    await db
      .table(ALLTODO_DB_TABLE_NAME)
      .where('tabSpaceId')
      .equals(TABSPACE_ID)
      .count(),
  ).toEqual(1);
});

test('a right side tool that was never opened writes nothing', async () => {
  // saving an empty store would leave an aggregate row keyed to no tabverse
  const { tabverseTab, w1 } = windowWithTabverseTab();
  tabSpaceStoreApi.updateTabSpace({
    id: TABSPACE_ID,
    chromeTabId: tabverseTab.id,
    chromeWindowId: w1.id,
  });

  await saveAndCloseTabSpace();

  expect(await db.table(TODO_DB_TABLE_NAME).count()).toEqual(0);
  expect(await db.table(ALLTODO_DB_TABLE_NAME).count()).toEqual(0);
  expect(await db.table(ALLNOTE_DB_TABLE_NAME).count()).toEqual(0);
  expect(await db.table(ALLBOOKMARK_DB_TABLE_NAME).count()).toEqual(0);
  expect(await db.table(CLOSED_TAB_DB_TABLE_NAME).count()).toEqual(0);
  // the tabverse itself is still saved
  expect(
    await db
      .table(TABSPACE_DB_TABLE_NAME)
      .where('id')
      .equals(TABSPACE_ID)
      .count(),
  ).toEqual(1);
});

test('a page that is not a tabverse tab still saves, and closes nothing', async () => {
  // chromeTabId < 0 happens in the dev page and in a page mid-bootstrap
  tabSpaceStoreApi.updateTabSpace({ id: TABSPACE_ID, chromeTabId: -1 });
  await expect(saveAndCloseTabSpace()).resolves.toBeUndefined();
  expect(
    await db
      .table(TABSPACE_DB_TABLE_NAME)
      .where('id')
      .equals(TABSPACE_ID)
      .count(),
  ).toEqual(1);
});
