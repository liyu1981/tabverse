import { TABSPACE_DB_VERSION } from '../../../global';
import { TabSpace } from '../TabSpace';
import { TabSpaceRegistry } from '../TabSpaceRegistry';

test('tabSpaceRegistry basics', () => {
  const tsr1 = new TabSpaceRegistry();
  expect(tsr1.registry.size).toBe(0);

  const ts1 = new TabSpace(100, 101, 'ts1');
  tsr1.add(ts1);
  expect(tsr1.findTabIdByChromeTabId(100)).toBe('ts1');
  tsr1.add(ts1);
  expect(tsr1.registry.size).toBe(1);
  const ts2 = new TabSpace(200, 201, 'ts1');
  tsr1.add(ts2);
  expect(tsr1.findTabIdByChromeTabId(200)).toBe('ts1');

  tsr1.removeByChromeTabId(300);
  expect(tsr1.registry.size).toBe(1);
  tsr1.removeByChromeTabId(200);
  expect(tsr1.registry.size).toBe(0);

  const ts3 = new TabSpace(300, 301, 'ts3');
  const ts4 = new TabSpace(400, 401, 'ts4');
  expect(
    tsr1.mergeRegistry([
      ts1.toTabSpaceStub(),
      ts2.toTabSpaceStub(),
      ts3.toTabSpaceStub(),
      ts4.toTabSpaceStub(),
    ]),
  ).toBeTruthy();
  expect(tsr1.registry.size).toBe(3);
  ['ts1', 'ts3', 'ts4'].map((id) => {
    expect(tsr1.registry.has(id)).toBeTruthy();
  });

  const ts5 = new TabSpace(500, 501, 'ts5');
  ts4.chromeTabId += 10;
  expect(tsr1.mergeRegistryChanges([])).toBeFalsy();
  expect(
    tsr1.mergeRegistryChanges([
      { from: ts5.id, to: ts5.id, entry: ts5.toTabSpaceStub() },
      { from: ts3.id, to: 'ts2', entry: ts3.toTabSpaceStub() },
      { from: 'ts2', to: ts3.id, entry: ts3.toTabSpaceStub() },
      { from: ts4.id, to: ts4.id, entry: ts4.toTabSpaceStub() },
    ]),
  ).toBeTruthy();
  ['ts1', 'ts3', 'ts4', 'ts5'].map((id) => {
    expect(tsr1.registry.has(id)).toBeTruthy();
  });

  expect(tsr1.toJSON()).toEqual({
    ts1: {
      id: 'ts1',
      version: TABSPACE_DB_VERSION,
      createdAt: -1,
      updatedAt: -1,
      name: 'Window-201',
      chromeTabId: 200,
      chromeWindowId: 201,
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
    ts4: {
      id: 'ts4',
      version: TABSPACE_DB_VERSION,
      createdAt: -1,
      updatedAt: -1,
      name: 'Window-401',
      chromeTabId: 410,
      chromeWindowId: 401,
    },
    ts3: {
      id: 'ts3',
      version: TABSPACE_DB_VERSION,
      createdAt: -1,
      updatedAt: -1,
      name: 'Window-301',
      chromeTabId: 300,
      chromeWindowId: 301,
    },
  });

  expect(tsr1.toMsgPayload()).toEqual([
    {
      id: 'ts1',
      version: TABSPACE_DB_VERSION,
      createdAt: -1,
      updatedAt: -1,
      name: 'Window-201',
      chromeTabId: 200,
      chromeWindowId: 201,
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
      id: 'ts4',
      version: TABSPACE_DB_VERSION,
      createdAt: -1,
      updatedAt: -1,
      name: 'Window-401',
      chromeTabId: 410,
      chromeWindowId: 401,
    },
    {
      id: 'ts3',
      version: TABSPACE_DB_VERSION,
      createdAt: -1,
      updatedAt: -1,
      name: 'Window-301',
      chromeTabId: 300,
      chromeWindowId: 301,
    },
  ]);

  expect(tsr1.filter((stub) => stub.id === 'ts3').toMsgPayload()).toEqual([
    {
      id: 'ts3',
      version: TABSPACE_DB_VERSION,
      createdAt: -1,
      updatedAt: -1,
      name: 'Window-301',
      chromeTabId: 300,
      chromeWindowId: 301,
    },
  ]);

  const tsr2 = tsr1.clone();
  expect(tsr1.registry.size).toBe(4);
});
