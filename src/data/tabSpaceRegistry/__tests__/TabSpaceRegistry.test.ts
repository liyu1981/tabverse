import { TABSPACE_DB_VERSION } from '../../../global';
import {
  newEmptyTabSpace,
  toTabSpaceStub,
  updateTabSpace,
} from '../../tabSpace/TabSpace';
import {
  addTabSpaceStub,
  cloneTabSpaceRegistry,
  filter,
  findTabSpaceIdByChromeTabId,
  mergeRegistry,
  mergeRegistryChanges,
  newEmptyTabSpaceRegistry,
  removeTabSpaceByChromeTabId,
  toMsgPayload,
  toTabSpaceRegistryInArray,
} from '../TabSpaceRegistry';

test('tabSpaceRegistry basics', () => {
  let tsr1 = newEmptyTabSpaceRegistry();
  expect(tsr1.size).toBe(0);

  const ts1 = updateTabSpace(
    { chromeTabId: 100, chromeWindowId: 101, id: 'ts1', name: `Window-${101}` },
    newEmptyTabSpace(),
  );
  tsr1 = addTabSpaceStub(ts1, tsr1);
  expect(findTabSpaceIdByChromeTabId(100, tsr1)).toBe('ts1');
  tsr1 = addTabSpaceStub(ts1, tsr1);
  expect(tsr1.size).toBe(1);
  const ts2 = updateTabSpace(
    { chromeTabId: 200, chromeWindowId: 201, id: 'ts2', name: `Window-${201}` },
    newEmptyTabSpace(),
  );
  tsr1 = addTabSpaceStub(ts2, tsr1);
  expect(findTabSpaceIdByChromeTabId(200, tsr1)).toBe('ts2');

  tsr1 = removeTabSpaceByChromeTabId(300, tsr1);
  expect(tsr1.size).toBe(2);
  tsr1 = removeTabSpaceByChromeTabId(200, tsr1);
  expect(tsr1.size).toBe(1);

  const ts3 = updateTabSpace(
    { chromeTabId: 300, chromeWindowId: 301, id: 'ts3', name: `Window-${301}` },
    newEmptyTabSpace(),
  );
  let ts4 = updateTabSpace(
    { chromeTabId: 400, chromeWindowId: 401, id: 'ts4', name: `Window-${401}` },
    newEmptyTabSpace(),
  );
  const { tabSpaceRegistry: r1, changed } = mergeRegistry(
    [
      toTabSpaceStub(ts1),
      toTabSpaceStub(ts2),
      toTabSpaceStub(ts3),
      toTabSpaceStub(ts4),
    ],
    tsr1,
  );
  tsr1 = r1;
  expect(changed).toBeTruthy();
  expect(tsr1.size).toBe(4);
  ['ts1', 'ts2', 'ts3', 'ts4'].map((id) => {
    expect(tsr1.has(id)).toBeTruthy();
  });

  const ts5 = updateTabSpace(
    { chromeTabId: 500, chromeWindowId: 501, id: 'ts5', name: `Window-${501}` },
    newEmptyTabSpace(),
  );
  ts4 = updateTabSpace({ chromeTabId: 410 }, ts4);
  const { changed: changed1 } = mergeRegistryChanges([], tsr1);
  expect(changed1).toBeFalsy();
  const { tabSpaceRegistry: r2, changed: changed2 } = mergeRegistryChanges(
    [
      { from: ts5.id, to: ts5.id, entry: toTabSpaceStub(ts5) },
      { from: ts3.id, to: ts2.id, entry: toTabSpaceStub(ts3) },
      { from: ts2.id, to: ts3.id, entry: toTabSpaceStub(ts2) },
      { from: ts4.id, to: ts4.id, entry: toTabSpaceStub(ts4) },
    ],
    tsr1,
  );
  tsr1 = r2;
  expect(changed2).toBeTruthy();
  [ts1.id, ts3.id, ts4.id, ts5.id].map((id) => {
    expect(tsr1.has(id)).toBeTruthy();
  });

  expect(toTabSpaceRegistryInArray(tsr1)).toEqual({
    ts1: {
      id: 'ts1',
      version: TABSPACE_DB_VERSION,
      createdAt: -1,
      updatedAt: -1,
      name: 'Window-101',
      chromeTabId: 100,
      chromeWindowId: 101,
    },
    ts4: {
      id: 'ts4',
      version: TABSPACE_DB_VERSION,
      createdAt: -1,
      updatedAt: -1,
      name: 'Window-401',
      chromeTabId: 410,
      chromeWindowId: 401,
    },
    ts5: {
      id: 'ts5',
      version: TABSPACE_DB_VERSION,
      createdAt: -1,
      updatedAt: -1,
      name: 'Window-501',
      chromeTabId: 500,
      chromeWindowId: 501,
    },
    ts3: {
      id: 'ts2',
      version: TABSPACE_DB_VERSION,
      createdAt: -1,
      updatedAt: -1,
      name: 'Window-201',
      chromeTabId: 200,
      chromeWindowId: 201,
    },
  });

  expect(toMsgPayload(tsr1)).toEqual([
    {
      id: 'ts1',
      version: TABSPACE_DB_VERSION,
      createdAt: -1,
      updatedAt: -1,
      name: 'Window-101',
      chromeTabId: 100,
      chromeWindowId: 101,
    },
    {
      id: 'ts4',
      version: TABSPACE_DB_VERSION,
      createdAt: -1,
      updatedAt: -1,
      name: 'Window-401',
      chromeTabId: 410,
      chromeWindowId: 401,
    },
    {
      id: 'ts5',
      version: TABSPACE_DB_VERSION,
      createdAt: -1,
      updatedAt: -1,
      name: 'Window-501',
      chromeTabId: 500,
      chromeWindowId: 501,
    },
    {
      id: 'ts2',
      version: TABSPACE_DB_VERSION,
      createdAt: -1,
      updatedAt: -1,
      name: 'Window-201',
      chromeTabId: 200,
      chromeWindowId: 201,
    },
  ]);

  expect(toMsgPayload(filter((stub) => stub.id === 'ts2', tsr1))).toEqual([
    {
      id: 'ts2',
      version: TABSPACE_DB_VERSION,
      createdAt: -1,
      updatedAt: -1,
      name: 'Window-201',
      chromeTabId: 200,
      chromeWindowId: 201,
    },
  ]);

  const tsr2 = cloneTabSpaceRegistry(tsr1);
  expect(tsr2.size).toBe(4);
});
