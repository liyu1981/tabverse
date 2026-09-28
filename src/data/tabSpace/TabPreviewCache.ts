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

export function getPreview(
  chromeTabId: number,
  targetTabPreviewCache: TabPreviewCache,
): string {
  return targetTabPreviewCache.previews.has(chromeTabId)
    ? targetTabPreviewCache.previews.get(chromeTabId)
    : 'https://dummyimage.com/500x280/ffffff/666666&text=Preview+Not+Yet+Generated';
}
