import { Map as ImmutableMap } from 'immutable';
import { produce } from 'immer';

export interface TabPreviewCache {
  previews: ImmutableMap<number, string>;
}

export function newEmptyTabPreviewCache(): TabPreviewCache {
  return {
    previews: ImmutableMap<number, string>(),
  };
}

export function setPreview(
  chromeTabId: number,
  previewData: string,
  targetTabPreviewCache: TabPreviewCache,
): TabPreviewCache {
  return produce(targetTabPreviewCache, (draft) => {
    draft.previews = draft.previews.set(chromeTabId, previewData);
  });
}

export function removePreview(
  chromeTabId: number,
  targetTabPreviewCache: TabPreviewCache,
): TabPreviewCache {
  return produce(targetTabPreviewCache, (draft) => {
    draft.previews = draft.previews.remove(chromeTabId);
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
