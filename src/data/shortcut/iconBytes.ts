/**
 * Turning a page's logo url into the bytes a shortcut keeps.
 *
 * A url is not enough for a launchpad: a site that blocks hotlinking, deletes
 * its icon or is simply unreachable from the device the Launchpad is opened on
 * would turn a tile into a broken image. So the chosen icon is fetched once,
 * decoded, drawn "contain" at no more than 128px and re-encoded as PNG, and
 * the `data:` string is stored in the record (and synced with it).
 *
 * This runs in a manager page *and* in the service worker (the toolbar popup
 * asks the worker to add the current tab), so the whole pipeline uses
 * `createImageBitmap` and `OffscreenCanvas`, which both exist in Chrome 140's
 * pages and workers. The browser-facing parts are injectable, so the node
 * tests drive the fetch/decode/encode flow with fakes and pin the caps; the
 * maths (`iconTargetSize`, `bytesToBase64`) is pure.
 *
 * Every failure is `''`: the caller falls back to the source url, then the
 * tab's favicon, then a monogram. An icon is a cache entry, never a promise.
 */
import { safeIconUrl } from './icon';

/** The long edge of the stored PNG; the tile draws it in a 64px box. */
export const SHORTCUT_ICON_MAX_EDGE = 128;
/** The retry when a 128px PNG is still over the text budget. */
export const SHORTCUT_ICON_FALLBACK_EDGE = 64;
/** Roughly 36 KB of image; a 128px logo normally takes 5-15 KB. */
export const MAX_ICON_DATA_URL_CHARS = 48_000;
/** A page can point its icon link anywhere; do not download a video. */
export const MAX_ICON_SOURCE_BYTES = 2_000_000;
/** An SVG is text; a small one is stored as-is and never rasterised. */
export const MAX_ICON_SVG_CHARS = 16_000;
/** A request that hangs must not hold an add (or the popup) open. */
export const ICON_FETCH_TIMEOUT_MS = 5_000;

/** How much of the source a short name can run to before it is absurd. */
const FALLBACK_RASTER_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/x-icon',
  'image/vnd.microsoft.icon',
];

export interface IconSize {
  width: number;
  height: number;
}

/**
 * The size to draw a logo at: the long edge is capped, the aspect ratio is
 * kept, and a small source is **never upscaled** (a 32px favicon drawn at
 * 128px is only more bytes, not more picture). A zero size means "not an
 * image" and the caller skips it.
 */
export function iconTargetSize(
  width: number,
  height: number,
  maxEdge: number = SHORTCUT_ICON_MAX_EDGE,
): IconSize {
  if (!(width > 0) || !(height > 0) || !(maxEdge > 0)) {
    return { width: 0, height: 0 };
  }
  const longest = Math.max(width, height);
  const scale = Math.min(1, maxEdge / longest);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Base64 without a call stack sized by the image. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    const part = Array.from(bytes.subarray(offset, offset + chunk));
    binary += String.fromCharCode(...part);
  }
  return btoa(binary);
}

export function dataUrlOf(contentType: string, bytes: Uint8Array): string {
  return `data:${contentType};base64,${bytesToBase64(bytes)}`;
}

/** An SVG is stored as text: `<img>` renders it and it cannot run script. */
export function svgDataUrl(svg: string): string {
  const text = String(svg ?? '');
  if (text.length <= 0 || text.length > MAX_ICON_SVG_CHARS) {
    return '';
  }
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
  return url.length <= MAX_ICON_DATA_URL_CHARS ? url : '';
}

export type IconDecoder = (blob: Blob) => Promise<ImageBitmap>;
export type IconEncoder = (
  bitmap: ImageBitmap,
  size: IconSize,
) => Promise<Blob>;

export type IconFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface IconFetchDeps {
  fetchFn?: IconFetch;
  decode?: IconDecoder;
  encode?: IconEncoder;
  timeoutMs?: number;
}

async function defaultDecode(blob: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('createImageBitmap is not available');
  }
  return createImageBitmap(blob);
}

async function defaultEncode(
  bitmap: ImageBitmap,
  size: IconSize,
): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'function') {
    throw new Error('OffscreenCanvas is not available');
  }
  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('no 2d context');
  }
  // the bitmap is drawn at the aspect the target size already keeps, so a
  // contain needs no letterboxing here; clearing is what keeps PNG alpha
  context.clearRect(0, 0, size.width, size.height);
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  return canvas.convertToBlob({ type: 'image/png' });
}

function contentTypeOf(response: Response): string {
  const raw = response.headers?.get?.('content-type') ?? '';
  return raw.split(';')[0].trim().toLowerCase();
}

function isSvg(contentType: string): boolean {
  return contentType === 'image/svg+xml';
}

function isFallbackRaster(contentType: string): boolean {
  return FALLBACK_RASTER_TYPES.includes(contentType);
}

/**
 * The stored icon for a url, or '' when it cannot be made.
 *
 * A `data:` source is already bytes and is returned (within the budget)
 * without a request, so a page that inlines its icon does not pay a fetch.
 */
export async function fetchIconAsDataUrl(
  url: string,
  deps: IconFetchDeps = {},
): Promise<string> {
  const source = String(url ?? '').trim();
  if (source.length <= 0) {
    return '';
  }
  if (source.toLowerCase().startsWith('data:')) {
    const safe = safeIconUrl(source);
    return safe.length <= MAX_ICON_DATA_URL_CHARS ? safe : '';
  }
  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return '';
  }

  const fetchFn = deps.fetchFn ?? (globalThis.fetch as IconFetch);
  if (typeof fetchFn !== 'function') {
    return '';
  }
  const timeoutMs = deps.timeoutMs ?? ICON_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchFn(parsed.href, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'force-cache',
      signal: controller.signal,
    });
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    return '';
  }
  // a declared length is the one chance to refuse a huge body before it is
  // downloaded; the actual size is checked again after `blob()`
  const declaredLength = Number(
    response.headers?.get?.('content-length') ?? '',
  );
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_ICON_SOURCE_BYTES
  ) {
    return '';
  }
  const contentType = contentTypeOf(response);

  if (isSvg(contentType)) {
    try {
      const text = await response.text();
      return svgDataUrl(text);
    } catch {
      return '';
    }
  }
  if (!contentType.startsWith('image/')) {
    return '';
  }

  let blob: Blob;
  try {
    blob = await response.blob();
  } catch {
    return '';
  }
  if (blob.size <= 0 || blob.size > MAX_ICON_SOURCE_BYTES) {
    return '';
  }

  const decode = deps.decode ?? defaultDecode;
  const encode = deps.encode ?? defaultEncode;
  try {
    const bitmap = await decode(blob);
    try {
      for (const edge of [
        SHORTCUT_ICON_MAX_EDGE,
        SHORTCUT_ICON_FALLBACK_EDGE,
      ]) {
        const size = iconTargetSize(bitmap.width, bitmap.height, edge);
        if (size.width <= 0 || size.height <= 0) {
          continue;
        }
        const encoded = await encode(bitmap, size);
        const bytes = new Uint8Array(await encoded.arrayBuffer());
        const dataUrl = dataUrlOf('image/png', bytes);
        if (dataUrl.length <= MAX_ICON_DATA_URL_CHARS) {
          return dataUrl;
        }
      }
    } finally {
      if (typeof bitmap.close === 'function') {
        bitmap.close();
      }
    }
  } catch {
    // fall through to the source bytes, which the browser may still render
  }

  if (!isFallbackRaster(contentType)) {
    return '';
  }
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length <= 0) {
      return '';
    }
    const dataUrl = dataUrlOf(contentType, bytes);
    return dataUrl.length <= MAX_ICON_DATA_URL_CHARS ? dataUrl : '';
  } catch {
    return '';
  }
}
