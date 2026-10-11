import { expect, test } from 'vitest';

import {
  loadSearchCache,
  saveSearchCache,
  type StorageLike,
} from './omniSearchCache';

function memoryStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

test('round-trips the last search', () => {
  const storage = memoryStorage();
  saveSearchCache('pasta', [{ entity: 'note', id: 'n1', score: 1 }], storage);
  const cached = loadSearchCache(storage);
  expect(cached?.query).toBe('pasta');
  expect(cached?.hits).toEqual([{ entity: 'note', id: 'n1', score: 1 }]);
});

test('a corrupt or missing cache is ignored', () => {
  const storage = memoryStorage();
  expect(loadSearchCache(storage)).toBeNull();
  storage.setItem('tabverse_omni_search_v1', '{not json');
  expect(loadSearchCache(storage)).toBeNull();
  storage.setItem('tabverse_omni_search_v1', '{"query":1}');
  expect(loadSearchCache(storage)).toBeNull();
});
