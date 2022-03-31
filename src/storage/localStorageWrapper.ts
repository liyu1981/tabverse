import { getWindow } from './localSetting';
import * as PubSub from 'pubsub-js';
import { hasOwnProperty } from '../global';

const _keysForMonitoring = {};

export function getLocalStorageKey(name: string) {
  return `tabverse_ls_${name}`;
}

export function localStorageInit() {
  const window = getWindow();
  if (window) {
    window.onstorage = (ev: StorageEvent) => {
      if (hasOwnProperty(_keysForMonitoring, ev.key)) {
        PubSub.publish(ev.key, {
          key: ev.key,
          newValue: ev.newValue,
          oldValue: ev.oldValue,
        });
      }
    };
  }
}

export function localStorageGetItem<T>(
  key: string,
  convertFn?: (value: string) => T,
): T | undefined {
  const window = getWindow();
  if (window) {
    const value = window.localStorage.getItem(key);
    if (value) {
      if (convertFn) {
        return convertFn(value);
      } else {
        return value as any as T;
      }
    } else {
      return undefined;
    }
  } else {
    return undefined;
  }
}

export function localStoragePutItem(key: string, value: string) {
  const window = getWindow();
  if (window) {
    window.localStorage.setItem(key, value);
  }
}

export function localStorageAddListener(
  key: string,
  callbackFn: (
    key: string,
    newValue: string,
    oldValue: string,
  ) => void | Promise<void>,
) {
  _keysForMonitoring[key] = true;
  PubSub.subscribe(key, (message: string, data: any) => {
    const { key, oldValue, newValue } = data;
    callbackFn && callbackFn(key, newValue, oldValue);
  });
}

export function localStorageRemoveListener(key: string) {
  delete _keysForMonitoring[key];
  PubSub.unsubscribe(key);
}
