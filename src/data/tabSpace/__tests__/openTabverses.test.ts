import {
  openTabSpaceOfWindow,
  openTabSpacesOf,
  openTabverseUrlInWindow,
  tabSpaceIdOfManagerTab,
  windowCountOfTabSpace,
} from '../openTabverses';
import { TABSPACE_MANAGER_TAB_URL_PREFIX } from '../../../global';
import { getMockChrome } from '../../../dev/chromeMock';

const managerUrl = (tvid: string) =>
  `${TABSPACE_MANAGER_TAB_URL_PREFIX}?op=new&tvid=${tvid}`;

const managerTab = (id: number, windowId: number, tvid: string) =>
  ({ id, windowId, url: managerUrl(tvid), pinned: true }) as chrome.tabs.Tab;

const normalTab = (id: number, windowId: number) =>
  ({ id, windowId, url: 'https://example.com/' }) as chrome.tabs.Tab;

test('the tabverse id comes out of the manager tab url', () => {
  expect(tabSpaceIdOfManagerTab(managerTab(1, 1, 'abc123'))).toEqual('abc123');
  // the id is url encoded in tabverseUrl(), and must survive a round trip
  expect(tabSpaceIdOfManagerTab(managerTab(1, 1, 'a%2Fb%20c'))).toEqual(
    'a/b c',
  );
  expect(tabSpaceIdOfManagerTab(managerTab(1, 1, '~unsaved'))).toEqual(
    '~unsaved',
  );
});

test('a tab that is not a manager page is not a tabverse', () => {
  expect(tabSpaceIdOfManagerTab(normalTab(1, 1))).toEqual('');
  expect(
    tabSpaceIdOfManagerTab({ id: 1, windowId: 1 } as chrome.tabs.Tab),
  ).toEqual('');
});

test('a manager page without a tvid (an older build) is skipped', () => {
  const legacy = {
    id: 7,
    windowId: 1,
    url: `${TABSPACE_MANAGER_TAB_URL_PREFIX}?op=new`,
  } as chrome.tabs.Tab;
  expect(tabSpaceIdOfManagerTab(legacy)).toEqual('');
  expect(openTabSpacesOf([legacy])).toEqual([]);
});

test('the map covers every window, and one tabverse can be in several', () => {
  const open = openTabSpacesOf([
    managerTab(1, 1, 'ts-a'),
    normalTab(2, 1),
    managerTab(3, 2, 'ts-b'),
    managerTab(4, 3, 'ts-a'),
  ]);

  expect(open.map((o) => o.tabSpaceId)).toEqual(['ts-a', 'ts-b', 'ts-a']);
  expect(windowCountOfTabSpace(open, 'ts-a')).toEqual(2);
  expect(windowCountOfTabSpace(open, 'ts-b')).toEqual(1);
  expect(windowCountOfTabSpace(open, 'ts-c')).toEqual(0);
});

test('at most one tabverse belongs to a window, and it is found by window', () => {
  const open = openTabSpacesOf([
    managerTab(1, 1, 'ts-a'),
    managerTab(3, 2, 'ts-b'),
  ]);
  expect(openTabSpaceOfWindow(open, 1)?.tabSpaceId).toEqual('ts-a');
  expect(openTabSpaceOfWindow(open, 2)?.tabSpaceId).toEqual('ts-b');
  expect(openTabSpaceOfWindow(open, 3)).toBeUndefined();
});

test('opening in a window reuses its manager tab instead of adding one', async () => {
  const mockChrome = getMockChrome();
  const w1 = mockChrome.addWindow();
  mockChrome.insertTabFromData(
    { title: 'x', url: 'https://x.com', favIconUrl: '', pinned: false },
    w1.id,
  );
  const manager = mockChrome.insertTabFromData(
    {
      title: 'Tabverse',
      url: managerUrl('ts-a'),
      favIconUrl: '',
      pinned: true,
    },
    w1.id,
  );
  const open = openTabSpacesOf([
    { ...manager, windowId: w1.id } as unknown as chrome.tabs.Tab,
  ]);
  const tabsBefore = (await chrome.tabs.query({ windowId: w1.id })).length;

  await openTabverseUrlInWindow(managerUrl('ts-b'), w1.id, open);

  expect((await chrome.tabs.query({ windowId: w1.id })).length).toEqual(
    tabsBefore,
  );
  expect(mockChrome.getTab(manager.id)?.url).toEqual(managerUrl('ts-b'));
});

test('opening in a window without a tabverse creates its tab', async () => {
  const mockChrome = getMockChrome();
  const w1 = mockChrome.addWindow();
  mockChrome.insertTabFromData(
    { title: 'x', url: 'https://x.com', favIconUrl: '', pinned: false },
    w1.id,
  );

  await openTabverseUrlInWindow(managerUrl('ts-new'), w1.id, []);

  const tabs = await chrome.tabs.query({ windowId: w1.id });
  expect(tabs.some((t: any) => t.url === managerUrl('ts-new'))).toBe(true);
});
