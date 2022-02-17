import { TabSpaceLogLevel, isJestTest, loglevel } from './debug';

import { debounce as lodashDebounce } from 'lodash';

// Do not manual edit it, use tools/version_update to update it.
export const TABSPACE_VERSION = 'v0.3.0';

export const TABSPACE_DB_VERSION = 7;

export const TABSPACE_MANAGER_TAB_TITLE_PREFIX = 'Tabverse:Manager';
export const TABSPACE_MANAGER_TAB_URL_PREFIX = global.chrome
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

// eslint-disable-next-line @typescript-eslint/ban-types
export function hasOwnProperty<X extends {}, Y extends PropertyKey>(
  obj: X,
  prop: Y,
): obj is X & Record<Y, unknown> {
  // eslint-disable-next-line no-prototype-builtins
  return obj && obj.hasOwnProperty(prop);
}

export function typeGuard<T>(x: any): x is T {
  return true;
}

export const debounce = isJestTest()
  ? (f: any, t: any) => f
  : (f: any, t: any) =>
      lodashDebounce(() => {
        f();
      }, t);

let _perf_timeStart = 0;
let _perf_timeEnd = 0;
export const perfStart: () => void = isJestTest()
  ? () => {}
  : () => {
      _perf_timeStart = Date.now();
    };

export const perfEnd: (message: string) => void = isJestTest()
  ? (message: string) => {}
  : (message: string) => {
      _perf_timeEnd = Date.now();
      console.log(
        `%cperf: ${message}, time used: ${_perf_timeEnd - _perf_timeStart}ms`,
        'color: red; background-color: yellow',
      );
    };
