import { Map as ImmutableMap } from 'immutable';
import { produce } from 'immer';

/**
 * The in-memory thumbnails, and how much of the heap they are allowed.
 *
 * A thumbnail is a base64 JPEG of the **whole window** (`chrome.tabs.
 * captureVisibleTab`, see chromeTab.ts), so it is not a small datum: on a
 * 1080p screen one is a few hundred kilobytes of text, on a hidpi or 4k screen
 * about a megabyte, and a JavaScript string costs two bytes per character on
 * top of that. The map used to grow one entry per tab the person has *visited*
 * while the page was open, with no limit at all - which is tens to hundreds of
 * megabytes on the "many tabs" profile this feature exists for, and it is what
 * made a long-lived manager page so heavy.
 *
 * So the cache is a bounded LRU-ish window now:
 *
 *  - `MAX_PREVIEW_CACHE_CHARS` caps the text held (roughly twice that in heap),
 *  - `MAX_PREVIEW_CACHE_ENTRIES` caps the count as a second guard,
 *  - the oldest capture is dropped first, and the newest is never dropped
 *    (a single image is always allowed, however large).
 *
 * The durable copy is unaffected: `tabPreviewStore` keeps up to
 * `MAX_STORED_PREVIEWS` rows in IndexedDB, and a thumbnail that fell out of
 * this window is read back when somebody hovers its row
 * (`tabPreviewStore.hydratePreview`). Dropping one here therefore costs a
 * database read, never a picture.
 */

/** Text budget: ~12 MB of heap for the cache, on the two-bytes-per-char rule. */
export const MAX_PREVIEW_CACHE_CHARS = 6_000_000;

/** Second guard, for profiles with many tiny captures. */
export const MAX_PREVIEW_CACHE_ENTRIES = 40;

export interface TabPreviewCache {
  previews: ImmutableMap<number, string>;
  /** The summed length of `previews`' values, kept instead of recomputed. */
  chars: number;
}

export function newEmptyTabPreviewCache(): TabPreviewCache {
  return {
    previews: ImmutableMap<number, string>(),
    chars: 0,
  };
}

function charsOf(previews: ImmutableMap<number, string>): number {
  return previews.reduce((sum, preview) => sum + preview.length, 0);
}

export function setPreview(
  chromeTabId: number,
  previewData: string,
  targetTabPreviewCache: TabPreviewCache,
): TabPreviewCache {
  const existing = targetTabPreviewCache.previews.get(chromeTabId);
  if (existing === previewData) {
    // The same picture again (a re-capture that produced identical bytes, or a
    // hydrate of something already here): keep the store value, so nothing
    // redraws for it.
    return targetTabPreviewCache;
  }
  // remove-then-set is what marks this id as the newest: Immutable's Map keeps
  // insertion order, and `set` on an existing key keeps the old position.
  let previews = targetTabPreviewCache.previews
    .remove(chromeTabId)
    .set(chromeTabId, previewData);
  const baseChars =
    typeof targetTabPreviewCache.chars === 'number'
      ? targetTabPreviewCache.chars
      : charsOf(targetTabPreviewCache.previews);
  let chars = baseChars - (existing ? existing.length : 0) + previewData.length;

  while (
    previews.size > 1 &&
    (previews.size > MAX_PREVIEW_CACHE_ENTRIES ||
      chars > MAX_PREVIEW_CACHE_CHARS)
  ) {
    const oldest = previews.keySeq().first();
    if (oldest === undefined) {
      break;
    }
    const dropped = previews.get(oldest);
    previews = previews.remove(oldest);
    chars -= dropped ? dropped.length : 0;
  }

  return produce(targetTabPreviewCache, (draft) => {
    draft.previews = previews;
    draft.chars = chars;
  });
}

export function removePreview(
  chromeTabId: number,
  targetTabPreviewCache: TabPreviewCache,
): TabPreviewCache {
  const existing = targetTabPreviewCache.previews.get(chromeTabId);
  if (existing === undefined) {
    return targetTabPreviewCache;
  }
  return produce(targetTabPreviewCache, (draft) => {
    draft.previews = draft.previews.remove(chromeTabId);
    draft.chars = Math.max(0, draft.chars - existing.length);
  });
}

/**
 * The thumbnail of a tab, or '' when there is none.
 *
 * '' rather than a placeholder image on purpose: the previews are a local cache
 * (see tabPreviewStore), so "not captured yet" is a normal state, not an error
 * to dress up. It used to be a dummyimage.com URL, which made hovering a tab
 * without a thumbnail fetch a picture from a third party - for the one feature
 * whose whole promise is that the picture never leaves the machine.
 */
export function getPreview(
  chromeTabId: number,
  targetTabPreviewCache: TabPreviewCache,
): string {
  return targetTabPreviewCache.previews.has(chromeTabId)
    ? targetTabPreviewCache.previews.get(chromeTabId)
    : '';
}
