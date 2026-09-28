import { TabSpaceLogLevel, isJestTest, loglevel } from './debug';

import { debounce as lodashDebounce } from 'lodash';

// Do not manual edit it, use tools/version_update to update it.
export const TABSPACE_VERSION = 'v0.5.0';

// v8 dropped the `chromesession` object store: the browser-session feature
// (periodic window/tab snapshots, the Session Browser route and the server side
// retention that pruned them) is gone - see ADR 0006. Dexie deletes stores that
// disappear from the schema on a version bump. A build older than this one can
// still open the database: it re-creates the missing store and carries on
// (see src/storage/__tests__/TabSpaceDatabase.upgrade.test.ts).
//
// v9 adds `SavedTabPreview`, so tab thumbnails survive a reload instead of
// living only in the page's memory. Still no data at risk on rollback: a
// pre-v9 build does not know the table and ignores it.
//
// v10 adds `SavedClosedTab`, the per tabverse list of tabs that were closed
// (the History right side tool). Same rollback story: a pre-v10 build does not
// know the table and ignores it.
export const TABSPACE_DB_VERSION = 10;

export const TABSPACE_MANAGER_TAB_TITLE_PREFIX = 'Tabverse:Manager';
// `global` is a Node-only global: webpack polyfilled it, Vite/Rolldown does
// not, so touching it at module scope threw "global is not defined" in the
// service worker and took every importer down with it. `globalThis.chrome` is
// the same object in the node test environment (src/dev/chromeMock.ts assigns
// to it) and exists in the extension.
export const TABSPACE_MANAGER_TAB_URL_PREFIX = globalThis.chrome
  ? `chrome-extension://${chrome.runtime.id}/manager.html`
  : `chrome-extension://tabverse-jest-test/manager.html`;

export function isTabSpaceManagerPage(tab: chrome.tabs.Tab): boolean {
  return tab.url && tab.url.startsWith(TABSPACE_MANAGER_TAB_URL_PREFIX);
}

export enum TabSpaceOp {
  New = 'new',
  LoadSaved = 'loadsaved',
}

export enum LoadStatus {
  Loading = 0,
  Done = 1,
  Error = 2,
  Idle = 3,
}

export const logger = {
  log: (...args: any[]) => {
    if (loglevel <= TabSpaceLogLevel.LOG) {
      console.log(...args);
    }
  },

  info: (...args: any[]) => {
    if (loglevel <= TabSpaceLogLevel.INFO) {
      console.info(...args);
    }
  },

  error: (...args: any[]) => {
    if (loglevel <= TabSpaceLogLevel.ERROR) {
      console.error(...args);
    }
  },
};

// `{}` is the idiom for a hasOwn constraint
export function hasOwn<X extends {}, Y extends PropertyKey>(
  obj: X,
  prop: Y,
): obj is X & Record<Y, unknown> {
  return obj && Object.hasOwn(obj, prop);
}

export function typeGuard<T>(x: any): x is T {
  return true;
}

/**
 * Drop-in replacement for node's `assert.strict`, which cannot be used in the
 * extension: Vite externalizes node builtins for the browser, so importing it
 * produced a stub whose `strict` is not a function and threw as soon as the
 * assertion ran (it killed manager.tsx bootstrap, which then made the
 * background's tab scan fail too).
 */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export const debounce = isJestTest()
  ? <T extends (...args: any[]) => any>(f: T, t: any) => f
  : <T extends (...args: any[]) => any>(f: T, t: any) =>
      lodashDebounce(() => {
        f();
      }, t);

const _perf_timeStart: { [name: string]: number } = {};
export const perfStart: (name: string) => void = isJestTest()
  ? (name: string) => {}
  : (name: string) => {
      _perf_timeStart[name] = Date.now();
    };

export const perfEnd: (name: string) => void = isJestTest()
  ? (name: string) => {}
  : (name: string) => {
      const _perf_timeEnd = Date.now();
      console.log(
        `%cperf: ${name}, time used: ${
          _perf_timeEnd - _perf_timeStart[name]
        }ms`,
        'color: red; background-color: yellow',
      );
      delete _perf_timeStart[name];
    };
