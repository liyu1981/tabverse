import {
  addTabs,
  convertAndGetTabSpaceSavePayload,
  findTabByChromeTabId,
  findTabById,
  fromSavedDataWithoutTabs,
  getTabIds,
  insertTab,
  newEmptyTabSpace,
  removeTab,
  removeTabByChromeTabId,
  removeTabById,
  replaceTab,
  replaceAllTabs,
  reset,
  setChromeTabId,
  setChromeWindowId,
  setId,
  setTabGroups,
  withSplitPartners,
  setName,
  updateTab,
  updateTabSpace,
} from '../TabSpace';
import {
  setChromeTabId as tabSetChromeTabId,
  setChromeWindowId as tabSetChromeWindowId,
  setId as tabSetId,
} from '../Tab';
import { SPLIT_VIEW_ID_NONE, Tab, newEmptyTab } from '../Tab';
import { List } from 'immutable';

test('constructor', () => {
  const ts = newEmptyTabSpace();
  expect(ts.name).toEqual('');
  expect(ts.chromeTabId).toBe(-1);
  expect(ts.chromeWindowId).toBe(-1);
  // tabverses are born saved (ADR: tvid in the tab url), so the id is final
  // from the start and the autosave has nothing to ask before writing
  expect(ts.id.length).toBeGreaterThan(0);

  const ts5 = setChromeTabId(
    300,
    setChromeWindowId(301, setName('Window-301', setId('testts5', ts))),
  );
  expect(ts5.id).toBe('testts5');
  expect(ts5.name).toBe('Window-301');
  expect(ts5.chromeTabId).toBe(300);
  expect(ts5.chromeWindowId).toBe(301);

  // a reset is a manager page taking over a window, so it is a new tabverse
  // with a new id
  const ts7 = reset({}, ts);
  expect(ts7.chromeTabId).toBe(-1);
  expect(ts7.chromeWindowId).toBe(-1);
  expect(ts7.id).not.toEqual(ts.id);
});

test('findTabById/findTabByChromeTabId', () => {
  let ts = newEmptyTabSpace();
  const t1 = tabSetChromeTabId(100, tabSetChromeWindowId(1000, newEmptyTab()));
  ts = insertTab({ tab: t1 }, ts);
  const t2 = tabSetChromeTabId(101, tabSetChromeWindowId(1000, newEmptyTab()));
  ts = insertTab({ tab: t2 }, ts);

  expect(findTabById(t1.id, ts).chromeTabId).toEqual(t1.chromeTabId);
  expect(findTabByChromeTabId(t2.chromeTabId, ts).id).toEqual(t2.id);
});

test('addTab/addTabs', () => {
  let ts = newEmptyTabSpace();
  const t1 = newEmptyTab();
  const t2 = newEmptyTab();
  const t3 = newEmptyTab();
  const t4 = newEmptyTab();
  ts = insertTab({ tab: t1 }, ts);
  ts = insertTab({ tab: t2, index: -1 }, ts);
  ts = insertTab({ tab: t3, index: 2 }, ts);
  ts = insertTab({ tab: t4, index: 1 }, ts);
  expect(getTabIds(ts)).toEqual([t2.id, t4.id, t1.id, t3.id]);
  ts.tabs.forEach((tab) => {
    expect(tab.tabSpaceId).toEqual(ts.id);
  });

  const t5 = newEmptyTab();
  const t6 = newEmptyTab();
  ts = addTabs([t5, t6], ts);
  expect(getTabIds(ts)).toEqual([t2.id, t4.id, t1.id, t3.id, t5.id, t6.id]);
});

test('updateTab', () => {
  let ts = newEmptyTabSpace();
  const t1 = newEmptyTab();
  ts = insertTab({ tab: t1 }, ts);

  const t2 = newEmptyTab();
  ts = insertTab({ tab: t2 }, ts);
  const changedTitle = t2.title + 'changed';
  ts = updateTab({ tid: t2.id, changes: { title: changedTitle } }, ts);

  expect(findTabById(t2.id, ts).title).toEqual(changedTitle);

  const t3 = newEmptyTab();
  const t4 = newEmptyTab();
  ts = replaceAllTabs([t3, t4], ts);
  expect(getTabIds(ts)).toEqual([t3.id, t4.id]);
});

test('removeTab/removeTabById/removeTabByChromeTabId', () => {
  let ts = newEmptyTabSpace();
  const t1 = tabSetChromeTabId(100, tabSetChromeWindowId(1000, newEmptyTab()));
  const t2 = tabSetChromeTabId(101, tabSetChromeWindowId(1000, newEmptyTab()));
  const t3 = tabSetChromeTabId(102, tabSetChromeWindowId(1000, newEmptyTab()));
  ts = addTabs([t1, t2, t3], ts);

  ts = removeTabById('888', ts);
  expect(getTabIds(ts)).toEqual([t1.id, t2.id, t3.id]);
  ts = removeTabById(t1.id, ts);
  expect(getTabIds(ts)).toEqual([t2.id, t3.id]);
  ts = removeTabByChromeTabId(t2.chromeTabId, ts);
  expect(getTabIds(ts)).toEqual([t3.id]);
  ts = removeTab(t3, ts);
  expect(getTabIds(ts).length).toEqual(0);
});

test('replaceTab/replaceAllTabs', () => {
  let ts = newEmptyTabSpace();
  const t1 = newEmptyTab();
  const t2 = newEmptyTab();
  const t3 = newEmptyTab();
  const t4 = newEmptyTab();
  ts = addTabs([t1, t2, t3], ts);

  ts = replaceTab({ tid: t2.id, tab: t4 }, ts);
  expect(getTabIds(ts)).toEqual([t1.id, t4.id, t3.id]);
  ts = replaceTab({ tid: '999', tab: t2 }, ts);
  expect(getTabIds(ts)).toEqual([t1.id, t4.id, t3.id]);

  ts = replaceAllTabs([t3, t2, t4], ts);
  expect(getTabIds(ts)).toEqual([t3.id, t2.id, t4.id]);
});

test('update', () => {
  let ts = newEmptyTabSpace();
  ts = updateTabSpace({ name: 'test' }, ts);
  expect(ts.name).toEqual('test');
});

test('convertAndGetSavePayload', () => {
  let ts = newEmptyTabSpace();
  const t1 = newEmptyTab();
  ts = insertTab({ tab: t1 }, ts);
  const { tabSpace, tabSpaceSavePayload, tabSavePayloads } =
    convertAndGetTabSpaceSavePayload(ts);
  // ids do not change on the way to the database, so the payload's tabIds are
  // the ids the store already had
  expect(tabSpaceSavePayload.tabIds).toEqual([t1.id]);
  expect(tabSavePayloads.length).toEqual(1);
  expect(tabSavePayloads[0].id).toEqual(t1.id);
  expect(tabSavePayloads[0].tabSpaceId).toEqual(ts.id);
  expect(tabSpace.id).toEqual(ts.id);

  const ts4 = fromSavedDataWithoutTabs(tabSpaceSavePayload);
  expect(ts4.id).toEqual(ts.id);
  expect(ts4.tabs.size).toEqual(0);
});

test('reset', () => {
  let ts = newEmptyTabSpace();
  const idBeforeReset = ts.id;
  ts = reset({ chromeTabId: 100, chromeWindowId: 101 }, ts);
  expect(ts.id).not.toEqual(idBeforeReset);
  expect(ts.chromeTabId).toBe(100);
  expect(ts.chromeWindowId).toBe(101);

  ts = setChromeTabId(200, setChromeWindowId(201, ts));
  expect(ts.chromeTabId).toBe(200);
  expect(ts.chromeWindowId).toBe(201);
});

test('the save payload keeps pinned tabs and group hints', () => {
  let ts = newEmptyTabSpace();
  ts = setId('ts1', ts);
  ts = setName('Window-1', ts);
  ts = addTabs(
    [
      {
        ...newEmptyTab(),
        ...tabSetId('t1', newEmptyTab()),
        pinned: true,
        title: 'pinned tab',
      },
      {
        ...newEmptyTab(),
        ...tabSetId('t2', newEmptyTab()),
        title: 'normal tab',
      },
    ],
    ts,
  );
  ts = setTabGroups(
    [{ id: 'g1', title: 'work', color: 'blue', tabIds: ['t1', 't2'] }],
    ts,
  );

  const { tabSpaceSavePayload, tabSpace, tabSavePayloads } =
    convertAndGetTabSpaceSavePayload(ts);

  expect(tabSpaceSavePayload.tabIds).toEqual(['t1', 't2']);
  expect(tabSpaceSavePayload.tabGroups).toEqual([
    { id: 'g1', title: 'work', color: 'blue', tabIds: ['t1', 't2'] },
  ]);
  // pinned survives the trip through the database, on both tabs
  const byId = Object.fromEntries(tabSavePayloads.map((t) => [t.id, t.pinned]));
  expect(byId).toEqual({ t1: true, t2: false });
  expect(tabSpace.tabGroups).toHaveLength(1);
});

test('a tabverse saved before groups existed loads with an empty list', () => {
  const legacy = {
    id: 'ts-old',
    name: 'Window-2',
    tabIds: ['t1'],
    version: 8,
    createdAt: 1,
    updatedAt: 2,
  } as any;
  expect(fromSavedDataWithoutTabs(legacy).tabGroups).toEqual([]);
});

/*
 * A group hint records the tab ids it saw at capture time. Ids are final from
 * creation, so a save has nothing to rename and membership only has to be
 * filtered: a hint that points at a tab this tabverse does not hold would stop
 * matching, and its tabs would render as unrelated entries.
 */
test('a save leaves group membership on the ids it already had', () => {
  let ts = newEmptyTabSpace();
  ts = setId('ts1', ts);
  ts = setName('Window-1', ts);
  ts = addTabs(
    [
      { ...newEmptyTab(), ...tabSetId('t1', newEmptyTab()), title: 'one' },
      { ...newEmptyTab(), ...tabSetId('t2', newEmptyTab()), title: 'two' },
    ],
    ts,
  );
  ts = setTabGroups(
    [{ id: 'g1', title: 'work', color: 'blue', tabIds: ['t1', 't2'] }],
    ts,
  );

  const { tabSpace, tabSpaceSavePayload } =
    convertAndGetTabSpaceSavePayload(ts);

  expect(tabSpace.tabs.map((t) => t.id).toArray()).toEqual(['t1', 't2']);
  expect(tabSpace.tabGroups).toEqual([
    { id: 'g1', title: 'work', color: 'blue', tabIds: ['t1', 't2'] },
  ]);
  expect(tabSpaceSavePayload.tabGroups).toEqual(tabSpace.tabGroups);
});

test('group membership for tabs that are gone is dropped, empty groups with it', () => {
  let ts = newEmptyTabSpace();
  ts = setId('ts2', ts);
  ts = addTabs([{ ...newEmptyTab(), ...tabSetId('t1', newEmptyTab()) }], ts);
  ts = setTabGroups(
    [
      { id: 'g1', title: 'gone', color: 'red', tabIds: ['deleted'] },
      { id: 'g2', title: 'kept', color: 'green', tabIds: ['t1'] },
    ],
    ts,
  );

  const { tabSpace } = convertAndGetTabSpaceSavePayload(ts);

  expect(tabSpace.tabGroups).toEqual([
    { id: 'g2', title: 'kept', color: 'green', tabIds: ['t1'] },
  ]);
});

// A split view is how the window looked, so the saved tabverse keeps it
// (ADR 0022). The pairing is written as the partner's tab id rather than as
// Chrome's split view id, because only the former means the same thing on every
// device - and these tests are what stop the two from being confused later.
describe('the save writes the split pairing', () => {
  const splitPair = (leftId: string, rightId: string) =>
    List<Tab>([
      { ...newEmptyTab(), id: 'loose', title: 'Loose' },
      { ...newEmptyTab(), id: leftId, title: 'Left', splitViewId: 7 },
      { ...newEmptyTab(), id: rightId, title: 'Right', splitViewId: 7 },
    ]);

  const savedSplitWith = (tabs: List<Tab>) =>
    convertAndGetTabSpaceSavePayload({
      ...newEmptyTabSpace(),
      tabs,
    }).tabSavePayloads.map((tab) => tab.splitWith ?? null);

  it('names each half of the split after the other', () => {
    expect(savedSplitWith(splitPair('t1', 't2'))).toEqual([null, 't2', 't1']);
  });

  it('drops the pairing when chrome names a split the tabverse no longer holds', () => {
    // Chrome has this tab in a split view, but the other half is not in the
    // tabverse any more. There is nothing to point at, so the row is corrected.
    const half = List<Tab>([
      {
        ...newEmptyTab(),
        id: 't1',
        title: 'Left',
        splitWith: 'gone',
        splitViewId: 7,
      },
    ]);
    expect(savedSplitWith(half)).toEqual([null]);
  });

  it('keeps the pairing a restored tabverse already had', () => {
    // A tabverse restored from disk has no live split ids - nothing has been
    // recreated in the window, and it cannot be (ADR 0022) - so the save must
    // take the record's word for the pairing instead of erasing it.
    const restored = List<Tab>([
      { ...newEmptyTab(), id: 't1', title: 'Left', splitWith: 't2' },
      { ...newEmptyTab(), id: 't2', title: 'Right', splitWith: 't1' },
    ]);
    expect(savedSplitWith(restored)).toEqual(['t2', 't1']);
  });

  it('drops the pairing when chrome says the tab is in no split', () => {
    // The closed split, retired. Chrome's "not in a split" is a value rather
    // than an absence (ADR 0022), so it is this case - and only this case - that
    // may throw a pairing away.
    const closed = splitPair('t1', 't2').map((tab) => ({
      ...tab,
      splitWith: tab.id === 'loose' ? undefined : tab.id === 't1' ? 't2' : 't1',
      splitViewId: SPLIT_VIEW_ID_NONE,
    }));
    expect(savedSplitWith(closed)).toEqual([null, null, null]);
  });

  it('keeps the pairing when chrome has no split view support at all', () => {
    // A browser before 140 answers nothing, and neither does a tab that is not
    // in a window - a tabverse restored from disk, or a row the console read.
    // Believing that silence would erase every pairing on every save, which is
    // the bug ADR 0022 exists to fix.
    const restored = List<Tab>([
      { ...newEmptyTab(), id: 't1', title: 'Left', splitWith: 't2' },
      { ...newEmptyTab(), id: 't2', title: 'Right', splitWith: 't1' },
    ]);
    expect(savedSplitWith(restored)).toEqual(['t2', 't1']);
  });

  it('returns the same rows when there is nothing to correct', () => {
    // Identity, not just equality: a new object for an unchanged row would look
    // like a changed tab and pull another save in behind it.
    const corrected = withSplitPartners(splitPair('t1', 't2'));
    expect(withSplitPartners(corrected).toArray()).toEqual(corrected.toArray());
    const loose = List<Tab>([{ ...newEmptyTab(), id: 'solo' }]);
    expect(withSplitPartners(loose).first()).toBe(loose.first());
  });
});
