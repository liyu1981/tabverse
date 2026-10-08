import { expect, test } from 'vitest';

import { PAIR_PATH } from './pair';
import { readQuery, writeQuery } from './queryRoute';

function fakeLocation(search: string) {
  return { pathname: '/console', search };
}

function fakeHistory() {
  const replaced: string[] = [];
  return {
    replaced,
    replaceState(_data: unknown, _unused: string, url?: string | null) {
      if (url) replaced.push(url);
    },
  };
}

test('a link that names an account and a tabverse reads back as one', () => {
  const params = readQuery(fakeLocation('?user=usr_1&tab=data&tabspace=ts_2'));
  expect(params.get('user')).toBe('usr_1');
  expect(params.get('tab')).toBe('data');
  expect(params.get('tabspace')).toBe('ts_2');
});

test('writing one key leaves the others alone', () => {
  // The console writes the query from three different places (a tab switch, a
  // drawer open, a search) and dropping an unrelated key would lose the account
  // the operator is looking at.
  const location = fakeLocation('?user=usr_1&tab=data');
  const history = fakeHistory();
  writeQuery(location, history, { tabspace: 'ts_9' });
  expect(history.replaced).toEqual([
    '/console?user=usr_1&tab=data&tabspace=ts_9',
  ]);
});

test('an empty value removes its key, which is how a drawer is closed', () => {
  const location = fakeLocation('?user=usr_1&tabspace=ts_9');
  const history = fakeHistory();
  writeQuery(location, history, { tabspace: '' });
  expect(history.replaced).toEqual(['/console?user=usr_1']);
});

test('an empty query stays empty rather than becoming a bare ?', () => {
  const history = fakeHistory();
  writeQuery(fakeLocation('?user=usr_1'), history, { user: '' });
  expect(history.replaced).toEqual(['/console']);
});

test('the pairing request in the query survives a rewrite', () => {
  // The window the extension opened carries ?ext=…&nonce=… on the pairing
  // page, and boot writes the account it lands on into the same query: neither
  // half may eat the other (adr/0024).
  const location = {
    pathname: PAIR_PATH,
    search: '?ext=abcdefghijklmnoabcdefhijklmnoabc&nonce=n-1',
  };
  const history = fakeHistory();
  writeQuery(location, history, { user: 'usr_1' });
  expect(history.replaced[0]).toMatch(/^\/console\/pair\?/);
  const written = new URLSearchParams(history.replaced[0].split('?')[1] ?? '');
  expect(written.get('ext')).toBe('abcdefghijklmnoabcdefhijklmnoabc');
  expect(written.get('nonce')).toBe('n-1');
  expect(written.get('user')).toBe('usr_1');
});
