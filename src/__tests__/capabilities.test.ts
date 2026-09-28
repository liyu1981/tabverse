/**
 * The capability table is what the fallback story rests on, so the detectors
 * are tested against a fake chrome rather than trusted.
 */
import {
  CAPABILITIES,
  detectChromeMajorVersion,
  hasCapability,
  missingCapabilities,
  resetCapabilitiesCacheForTest,
} from '../capabilities';

const originalChrome = (globalThis as any).chrome;

function fakeChrome(tabs: any, tabGroups?: any) {
  (globalThis as any).chrome = { tabs, tabGroups };
}

beforeEach(() => {
  resetCapabilitiesCacheForTest();
});

afterAll(() => {
  (globalThis as any).chrome = originalChrome;
});

test('a modern chrome misses nothing', () => {
  fakeChrome(
    {
      SPLIT_VIEW_ID_NONE: -1,
      createSplit: () => Promise.resolve(1),
      unsplit: () => Promise.resolve(undefined),
    },
    { query: () => Promise.resolve([]) },
  );

  expect(missingCapabilities()).toHaveLength(0);
  expect(hasCapability('tabGroups')).toBe(true);
  expect(hasCapability('splitViewRead')).toBe(true);
  expect(hasCapability('splitViewWrite')).toBe(true);
});

test('chrome 139 loses split view reading and writing, keeps groups', () => {
  fakeChrome({}, { query: () => Promise.resolve([]) });

  const missing = missingCapabilities().map((c) => c.id);
  expect(missing).toEqual(['splitViewRead', 'splitViewWrite']);
  expect(hasCapability('tabGroups')).toBe(true);
});

test('chrome 88 loses groups too', () => {
  fakeChrome({});

  const missing = missingCapabilities().map((c) => c.id);
  expect(missing).toEqual(['tabGroups', 'splitViewRead', 'splitViewWrite']);
});

test('no chrome at all (unit tests) loses everything and does not throw', () => {
  delete (globalThis as any).chrome;

  expect(missingCapabilities().map((c) => c.id)).toEqual(
    CAPABILITIES.map((c) => c.id),
  );
  expect(hasCapability('tabGroups')).toBe(false);
});

test('the missing list is cached until the test hook resets it', () => {
  fakeChrome({}, {});
  expect(missingCapabilities()).toHaveLength(3);

  fakeChrome(
    {
      SPLIT_VIEW_ID_NONE: -1,
      createSplit: () => Promise.resolve(1),
      unsplit: () => Promise.resolve(undefined),
    },
    { query: () => Promise.resolve([]) },
  );
  expect(missingCapabilities()).toHaveLength(3); // still the cached answer

  resetCapabilitiesCacheForTest();
  expect(missingCapabilities()).toHaveLength(0);
});

test('every capability explains itself and names a version', () => {
  for (const capability of CAPABILITIES) {
    expect(capability.title.length).toBeGreaterThan(0);
    expect(capability.lost.length).toBeGreaterThan(10);
    expect(capability.requiresChrome).toBeGreaterThan(0);
  }
});

test('the chrome version is read from the user agent', () => {
  const originalUa = navigator.userAgent;
  Object.defineProperty(navigator, 'userAgent', {
    value: 'Mozilla/5.0 (Windows NT 10.0) Chrome/154.0.0.0 Safari/537.36',
    configurable: true,
  });
  expect(detectChromeMajorVersion()).toBe(154);

  Object.defineProperty(navigator, 'userAgent', {
    value: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/141.0',
    configurable: true,
  });
  expect(detectChromeMajorVersion()).toBe(0);

  Object.defineProperty(navigator, 'userAgent', {
    value: originalUa,
    configurable: true,
  });
});
