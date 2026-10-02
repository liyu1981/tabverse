import { expect, test } from 'vitest';

import { readHash, writeHash } from './hashRoute';

function fakeLocation(hash: string) {
  return { hash, pathname: '/', search: '' };
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
  const params = readHash(fakeLocation('#user=usr_1&tab=data&tabspace=ts_2'));
  expect(params.get('user')).toBe('usr_1');
  expect(params.get('tab')).toBe('data');
  expect(params.get('tabspace')).toBe('ts_2');
});

test('writing one key leaves the others alone', () => {
  // The console writes the fragment from three different places (a tab switch, a
  // drawer open, a search) and dropping an unrelated key would lose the account
  // the operator is looking at.
  const location = fakeLocation('#user=usr_1&tab=data');
  const history = fakeHistory();
  writeHash(location, history, { tabspace: 'ts_9' });
  expect(history.replaced).toEqual(['/#user=usr_1&tab=data&tabspace=ts_9']);
});

test('an empty value removes its key, which is how a drawer is closed', () => {
  const location = fakeLocation('#user=usr_1&tabspace=ts_9');
  const history = fakeHistory();
  writeHash(location, history, { tabspace: '' });
  expect(history.replaced).toEqual(['/#user=usr_1']);
});

test('an empty fragment stays empty rather than becoming a bare #', () => {
  const history = fakeHistory();
  writeHash(fakeLocation('#user=usr_1'), history, { user: '' });
  expect(history.replaced).toEqual(['/']);
});
