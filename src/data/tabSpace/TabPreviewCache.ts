import { Map } from 'immutable';

export interface TabPreviewCache {
  previews: Map<number, string>;
}

export function newEmptyTabPreviewCache(): TabPreviewCache {
  return {
    previews: Map<number, string>(),
  };
}

export function setPreview(
  chromeTabId: number,
  previewData: string,
  targetTabPreviewCache: TabPreviewCache,
): TabPreviewCache {
  return {
    ...targetTabPreviewCache,
    previews: targetTabPreviewCache.previews.set(chromeTabId, previewData),
  };
}

export function removePreview(
  chromeTabId: number,
  targetTabPreviewCache: TabPreviewCache,
): TabPreviewCache {
  return {
    ...targetTabPreviewCache,
    previews: targetTabPreviewCache.previews.remove(chromeTabId),
  };
}

export function getPreview(
  chromeTabId: number,
  targetTabPreviewCache: TabPreviewCache,
): string {
  return targetTabPreviewCache.previews.has(chromeTabId)
    ? targetTabPreviewCache.previews.get(chromeTabId)
    : 'https://dummyimage.com/500x280/ffffff/666666&text=Preview+Not+Yet+Generated';
}
