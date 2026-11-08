/**
 * Shrinking a captured window down to thumbnail size before it is kept.
 *
 * `chrome.tabs.captureVisibleTab` photographs the whole **visible window** at
 * the screen's device resolution, so a 1080p capture is a few hundred kilobytes
 * of JPEG and a hidpi/4k one about a megabyte - for a picture that is drawn in
 * a 524px card (`TabCard.previewCard`). Every copy of it (the in-memory cache,
 * the IndexedDB row, the string the store carries between them) pays that size
 * again, and the person pays it for every tab they ever looked at.
 *
 * So a capture is re-encoded once, at a width that is still crisp at 2x the
 * card, before it is stored. Three rules:
 *
 *  - **Never bigger, never broken.** A capture already narrower than the target
 *    is returned untouched, the result is only used when it is actually
 *    smaller, and any failure (no canvas, no decode, a browser that refuses
 *    `toDataURL`) returns the original. This runs in the page, not the worker,
 *    and is not worth a thrown error there.
 *  - **No browser in the unit tests.** They run in node without `Image` or a
 *    canvas, which is exactly the "no canvas" branch - the fixture data URLs
 *    come back unchanged and the tests stay about the flow.
 *  - **The geometry is a pure function** (`previewTargetSize`) so the scaling
 *    rule is testable without a browser (ADR 0019).
 */

/** Wide enough for the 524px card at 2x, and no wider. */
export const PREVIEW_MAX_WIDTH = 1024;

/** JPEG quality for the shrunk copy. The card is a hover preview, not a photo. */
export const PREVIEW_JPEG_QUALITY = 0.72;

export interface PreviewSize {
  width: number;
  height: number;
}

/** The size the shrunk copy should have, keeping the aspect ratio. */
export function previewTargetSize(
  width: number,
  height: number,
  maxWidth: number = PREVIEW_MAX_WIDTH,
): PreviewSize {
  if (!(width > 0) || !(height > 0)) {
    return { width: 0, height: 0 };
  }
  if (width <= maxWidth) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const scale = maxWidth / width;
  return {
    width: Math.round(maxWidth),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** True where the page can decode an image and encode a canvas. */
function canShrink(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof Image !== 'undefined' &&
    typeof document.createElement === 'function'
  );
}

/**
 * A smaller copy of a `data:image/...` capture, or the capture itself when it
 * cannot be made smaller. Never throws.
 */
export async function shrinkPreview(dataUrl: string): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith('data:image/') || !canShrink()) {
    return dataUrl;
  }
  try {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const target = previewTargetSize(image.naturalWidth, image.naturalHeight);
    if (target.width === 0 || target.height === 0) {
      return dataUrl;
    }
    if (
      image.naturalWidth <= PREVIEW_MAX_WIDTH &&
      image.naturalHeight <= PREVIEW_MAX_WIDTH
    ) {
      // Already small: nothing to gain from a re-encode.
      return dataUrl;
    }
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d');
    if (!context) {
      return dataUrl;
    }
    context.drawImage(image, 0, 0, target.width, target.height);
    const shrunk = canvas.toDataURL('image/jpeg', PREVIEW_JPEG_QUALITY);
    // A re-encode can lose (a small, flat screenshot at quality 1), so only
    // use it when it actually saved something.
    return shrunk.startsWith('data:image/jpeg') &&
      shrunk.length < dataUrl.length
      ? shrunk
      : dataUrl;
  } catch {
    return dataUrl;
  }
}
