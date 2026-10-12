import { expect, test } from 'vitest';

import {
  TABVERSE_EXPORT_FORMAT,
  TABVERSE_EXPORT_VERSION,
  tabverseFileName,
} from '../exportTabSpace';

test('the export carries a format marker and version', () => {
  expect(TABVERSE_EXPORT_FORMAT).toBe('tabverse');
  expect(TABVERSE_EXPORT_VERSION).toBe(1);
});

test('builds a .tabverse file name from the tabverse title', () => {
  expect(tabverseFileName('My Tabverse', 'ts1')).toBe('My Tabverse.tabverse');
  expect(tabverseFileName('  spaced   name  ', 'ts1')).toBe(
    'spaced name.tabverse',
  );
  // path and reserved characters cannot end up in a download name
  expect(tabverseFileName('a/b:c', 'ts1')).toBe('a_b_c.tabverse');
  // no name: fall back to the id, then to a constant
  expect(tabverseFileName('', 'ts_123')).toBe('ts_123.tabverse');
  expect(tabverseFileName(undefined, '')).toBe('tabverse.tabverse');
});
