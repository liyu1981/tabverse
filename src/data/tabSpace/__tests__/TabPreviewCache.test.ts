import {
  MAX_PREVIEW_CACHE_CHARS,
  MAX_PREVIEW_CACHE_ENTRIES,
  getPreview,
  newEmptyTabPreviewCache,
  removePreview,
  setPreview,
} from '../TabPreviewCache';

// No thumbnail is a normal state, not something to dress up: the previews are a
// local cache (data/tabSpace/previewReaper), so "not captured yet" comes back as
// '' and the card renders without a picture. It used to be a dummyimage.com
// URL, which made a hover fetch a picture from a third party.
test('a tab without a thumbnail has none, rather than a placeholder image', () => {
  let tp = newEmptyTabPreviewCache();
  expect(getPreview(1000, tp)).toBe('');
  tp = setPreview(1000, 'data123', tp);
  expect(getPreview(1000, tp)).toBe('data123');
  tp = removePreview(1000, tp);
  expect(getPreview(1000, tp)).toBe('');
});

/**
 * The cache is a bounded window, not a per-tab store: a thumbnail is a
 * whole-window screenshot, so one entry per tab visited is tens to hundreds of
 * megabytes on the profile the feature exists for. These pin the bounds and the
 * rule that the picture just captured always survives.
 */
test('the cache drops the oldest captures once it is over the entry cap', () => {
  let tp = newEmptyTabPreviewCache();
  const over = MAX_PREVIEW_CACHE_ENTRIES + 3;
  for (let id = 1; id <= over; id++) {
    tp = setPreview(id, `data:${id}`, tp);
  }

  expect(tp.previews.size).toBe(MAX_PREVIEW_CACHE_ENTRIES);
  // the oldest are gone, the newest are here
  expect(getPreview(1, tp)).toBe('');
  expect(getPreview(over, tp)).toBe(`data:${over}`);
  expect(tp.previews.size).toBeLessThanOrEqual(MAX_PREVIEW_CACHE_ENTRIES);
});

test('the cache is bounded by characters as well as by count', () => {
  let tp = newEmptyTabPreviewCache();
  const chunk = 'x'.repeat(1_000_000);
  for (let id = 1; id <= 20; id++) {
    tp = setPreview(id, `${chunk}${id}`, tp);
  }

  expect(tp.chars).toBeLessThanOrEqual(MAX_PREVIEW_CACHE_CHARS);
  // still the newest
  expect(getPreview(20, tp)).not.toBe('');
});

test('a single capture is never evicted for being too large', () => {
  let tp = newEmptyTabPreviewCache();
  tp = setPreview(1, 'x'.repeat(MAX_PREVIEW_CACHE_CHARS + 1), tp);

  expect(getPreview(1, tp)).not.toBe('');
});

test('re-capturing the same bytes keeps the store value', () => {
  let tp = newEmptyTabPreviewCache();
  tp = setPreview(1, 'data:1', tp);
  const same = setPreview(1, 'data:1', tp);

  expect(same).toBe(tp);
});

test('re-capturing moves a tab to the newest position, and remove frees it', () => {
  let tp = newEmptyTabPreviewCache();
  tp = setPreview(1, 'data:1', tp);
  tp = setPreview(2, 'data:2', tp);
  tp = setPreview(1, 'data:1b', tp);

  expect(tp.previews.keySeq().toArray()).toEqual([2, 1]);
  tp = removePreview(1, tp);
  expect(tp.chars).toBe('data:2'.length);
  expect(getPreview(1, tp)).toBe('');
});
