import { getSettingItem } from './storage/localSetting';
import { merge } from 'lodash';

export enum TabSpaceLogLevel {
  LOG = 1,
  INFO = 2,
  ERROR = 3,
}

export function isDebug() {
  return getSettingItem<boolean>('debug', (v) => v !== undefined);
}

/**
 * True while running inside the unit test runner (vitest sets VITEST,
 * jest used JEST_WORKER_ID). The `typeof` guard keeps this safe inside the
 * extension: there is no `process` global in a service worker or a page.
 */
export function isJestTest(): boolean {
  return Boolean(
    typeof process !== 'undefined' &&
      process.env &&
      (process.env['VITEST'] || process.env['JEST_WORKER_ID']),
  );
}

declare global {
  interface Window {
    /** Debug data exposed for manual inspection (see exposeDebugData). */
    tabverse?: Record<string, Record<string, unknown>>;
  }
}

export function exposeDebugData(
  name: string,
  value: Record<string, unknown>,
): void {
  if (!getSettingItem<boolean>('debug', (v) => v !== undefined)) {
    return;
  }
  window.tabverse ??= {};
  window.tabverse[name] ??= {};
  merge(window.tabverse[name], value);
}

let debugLogLevel = TabSpaceLogLevel.ERROR + 1;

export function setDebugLogLevel(level: TabSpaceLogLevel) {
  debugLogLevel = level;
}

function getDebugLogLevel() {
  return debugLogLevel;
}

export const loglevel = isJestTest()
  ? getDebugLogLevel()
  : getSettingItem<TabSpaceLogLevel>('loglevel', (v) => parseInt(v, 10)) ||
    TabSpaceLogLevel.INFO;
