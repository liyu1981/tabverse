import { getSettingItem } from './store/localSetting';
import { merge } from 'lodash';

export enum TabSpaceLogLevel {
  LOG = 1,
  INFO = 2,
  ERROR = 3,
}

export function isDebug() {
  return getSettingItem<boolean>('debug', (v) => v !== undefined);
}

export function isJestTest() {
  return process && process.env['JEST_WORKER_ID'];
}

export function exposeDebugData(name: string, value: any) {
  if (!getSettingItem<boolean>('debug', (v) => v !== undefined)) {
    return;
  }

  // @ts-ignore
  if (!window.tabverse) {
    // @ts-ignore
    window.tabverse = {};
  }
  // @ts-ignore
  if (!window.tabverse[name]) {
    // @ts-ignore
    window.tabverse[name] = {};
  }
  // @ts-ignore
  merge(window.tabverse[name], value);
}

let debugLogLevel = TabSpaceLogLevel.ERROR + 1;

export function setDebugLogLevel(level: TabSpaceLogLevel) {
  debugLogLevel = level;
}

function getDebugLogLevel() {
  return debugLogLevel;
}

export function setDebugLogLevelOn(isOn: boolean) {
  if (isOn) {
    debugLogLevel = TabSpaceLogLevel.LOG;
  } else {
    debugLogLevel = TabSpaceLogLevel.ERROR + 1;
  }
}

export const loglevel =
  process && process.env['JEST_WORKER_ID']
    ? getDebugLogLevel()
    : getSettingItem<TabSpaceLogLevel>('loglevel', (v) => parseInt(v)) ||
      TabSpaceLogLevel.INFO;
