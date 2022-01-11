import { useState } from 'react';

export function getWindow() {
  return typeof window === 'undefined' ? null : window;
}

export function getSettingItem<T>(
  name: string,
  convertFn?: (value: string) => T,
): T | undefined {
  const window = getWindow();
  if (window) {
    const value = window.localStorage.getItem(name);
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

function putSettingItem(name: string, value: string) {
  const window = getWindow();
  if (window) {
    window.localStorage.setItem(name, value);
  }
}

export function useSettingItem<T>(
  name: string,
  convertFn: (value: string) => T,
  serializeFn: (value: T) => string,
): [T, (newValue: T) => void] {
  const [settingValue, setSettingValue] = useState<T>(
    getSettingItem<T>(name, convertFn),
  );
  const setSettingValueWrapped = (newValue: T) => {
    const serializedValue = serializeFn(newValue);
    putSettingItem(name, serializedValue);
    setSettingValue(newValue);
  };
  return [settingValue, setSettingValueWrapped];
}
