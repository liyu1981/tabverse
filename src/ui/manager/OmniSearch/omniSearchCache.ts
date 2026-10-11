import type { SearchHit } from '../../../data/repo/types';

/**
 * The last omni search, kept in localStorage so switching back to the search
 * view shows what the user last looked at instead of an empty box. Window-local
 * on purpose: it is a UI convenience, not synced state, and it must not grow
 * chrome.storage. Any failure (private mode, quota) just means no cache.
 */
const CACHE_KEY = 'tabverse_omni_search_v1';

export interface CachedSearch {
  query: string;
  hits: SearchHit[];
  at: number;
}

/** The bit of `Storage` this needs, so tests can pass a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

export function loadSearchCache(
  storage: StorageLike | null = defaultStorage(),
): CachedSearch | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.query !== 'string' || !Array.isArray(parsed?.hits)) {
      return null;
    }
    return { query: parsed.query, hits: parsed.hits, at: parsed.at ?? 0 };
  } catch {
    return null;
  }
}

export function saveSearchCache(
  query: string,
  hits: SearchHit[],
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(CACHE_KEY, JSON.stringify({ query, hits, at: Date.now() }));
  } catch {
    // a cache that cannot be written is not an error
  }
}
