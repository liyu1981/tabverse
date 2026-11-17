/**
 * Finding and choosing a site's logo.
 *
 * The interesting part of an iOS/macOS icon is not the 16px favicon but the
 * large `apple-touch-icon` a site ships for its home-screen tile. So the page
 * is asked for its icon links, one is chosen by kind and declared size, and
 * the chosen url is then fetched and stored as bytes (`iconBytes.ts`); the
 * ranking here is pure, and the page read is an injectable seam so the tests
 * need no browser.
 *
 * Why `og:image` is not used: it is a social card, not an icon. Why
 * `link[rel=manifest]` is not fetched (yet): a second request and an untrusted
 * JSON document for a quality `apple-touch-icon` already provides.
 */
import { logger } from '../../global';

export interface IconLink {
  href: string;
  /** The raw `rel` attribute, so the space-separated tokens survive. */
  rel: string;
  /** The declared sizes, largest first; empty for `sizes="any"` or no sizes. */
  sizes: number[];
}

/** A source url is small; a stored data url is bounded by the icon budget. */
export const MAX_ICON_URL_CHARS = 60_000;

const DATA_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/svg+xml',
];

function relTokens(rel: string): string[] {
  return String(rel ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

export function isAppleTouchRel(rel: string): boolean {
  const tokens = relTokens(rel);
  return (
    tokens.includes('apple-touch-icon') ||
    tokens.includes('apple-touch-icon-precomposed')
  );
}

export function isIconRel(rel: string): boolean {
  return relTokens(rel).includes('icon');
}

/** `"32x32 64x64"` -> `[64, 32]`; `"any"` and junk -> `[]`. */
export function parseIconSizes(sizes: string | null | undefined): number[] {
  const found: number[] = [];
  const text = String(sizes ?? '');
  const match = /(\d+)\s*[xX]\s*(\d+)/g;
  let current = match.exec(text);
  while (current !== null) {
    const width = Number(current[1]);
    const height = Number(current[2]);
    const edge = Math.max(width, height);
    if (Number.isFinite(edge) && edge > 0 && !found.includes(edge)) {
      found.push(edge);
    }
    current = match.exec(text);
  }
  found.sort((a, b) => b - a);
  return found;
}

function declaredSize(link: IconLink): number {
  return link.sizes.length > 0 ? link.sizes[0] : 0;
}

/**
 * A url that is safe to store and draw: an http(s) url, or a small
 * `data:image/...` string. Everything else is a hostile page's payload or a
 * browser-internal url another page cannot load, and is dropped.
 */
export function safeIconUrl(raw: string): string {
  const text = String(raw ?? '').trim();
  if (text.length <= 0 || text.length > MAX_ICON_URL_CHARS) {
    return '';
  }
  if (text.toLowerCase().startsWith('data:')) {
    const comma = text.indexOf(',');
    if (comma < 0) {
      return '';
    }
    const header = text.slice(0, comma).toLowerCase();
    if (!DATA_IMAGE_TYPES.some((type) => header.startsWith(`data:${type}`))) {
      return '';
    }
    return text;
  }
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.href;
  } catch {
    return '';
  }
}

/** Resolves a link href against the page and keeps it only when it is usable. */
export function absoluteIconUrl(href: string, pageUrl: string): string {
  const text = String(href ?? '').trim();
  if (text.length <= 0) {
    return '';
  }
  if (text.toLowerCase().startsWith('data:')) {
    return safeIconUrl(text);
  }
  try {
    return safeIconUrl(new URL(text, pageUrl).href);
  } catch {
    return '';
  }
}

/**
 * The best logo among a page's links, or '' when it declares none.
 *
 * `apple-touch-icon` beats a plain icon whatever its declared size (it is the
 * one a site prepares at 180px for exactly this purpose); within a kind, the
 * largest declared size wins, and links without a size are treated as 32px.
 * The original order is the last tiebreak, so a page with two identical 180px
 * icons gets the first one deterministically.
 */
export function pickBestIconUrl(
  links: readonly IconLink[],
  pageUrl: string,
): string {
  const ranked = links
    .map((link, index) => {
      const href = absoluteIconUrl(link.href, pageUrl);
      const apple = isAppleTouchRel(link.rel);
      const icon = isIconRel(link.rel);
      return {
        href,
        index,
        rank: apple ? 2 : icon ? 1 : 0,
        size: declaredSize(link),
      };
    })
    .filter((entry) => entry.href.length > 0 && entry.rank > 0);
  ranked.sort(
    (a, b) => b.rank - a.rank || b.size - a.size || a.index - b.index,
  );
  return ranked.length > 0 ? ranked[0].href : '';
}

/**
 * The function that runs inside the page. It must be self-contained: Chrome
 * serialises it and runs it in another context, so it cannot close over
 * anything from this module (not even `parseIconSizes`).
 */
export function collectIconLinks(): IconLink[] {
  const out: IconLink[] = [];
  const links = Array.from(document.querySelectorAll('link[rel][href]'));
  for (const link of links) {
    const rel = link.getAttribute('rel') ?? '';
    const tokens = rel.toLowerCase().split(/\s+/).filter(Boolean);
    if (
      !tokens.includes('icon') &&
      !tokens.includes('apple-touch-icon') &&
      !tokens.includes('apple-touch-icon-precomposed')
    ) {
      continue;
    }
    const href = link.getAttribute('href') ?? '';
    if (href.length <= 0) {
      continue;
    }
    const sizes: number[] = [];
    const sizeText = link.getAttribute('sizes') ?? '';
    const match = /(\d+)\s*[xX]\s*(\d+)/g;
    let current = match.exec(sizeText);
    while (current !== null) {
      const edge = Math.max(Number(current[1]), Number(current[2]));
      if (Number.isFinite(edge) && edge > 0 && !sizes.includes(edge)) {
        sizes.push(edge);
      }
      current = match.exec(sizeText);
    }
    sizes.sort((a, b) => b - a);
    out.push({ href, rel, sizes });
  }
  return out;
}

/** Reads the icon links of a live tab; [] on a page Chrome will not script. */
export async function readIconLinks(chromeTabId: number): Promise<IconLink[]> {
  if (
    typeof chrome === 'undefined' ||
    !chrome.scripting ||
    typeof chrome.scripting.executeScript !== 'function' ||
    chromeTabId <= 0
  ) {
    return [];
  }
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: chromeTabId },
      func: collectIconLinks,
    });
    const first = results?.[0]?.result;
    return Array.isArray(first) ? (first as IconLink[]) : [];
  } catch (err) {
    // a chrome:// page, a PDF viewer, a discarded tab, a tab that navigated
    // away: no icon, not a failed add
    logger.log('shortcut: could not read the page icons', chromeTabId, err);
    return [];
  }
}

/** The first letter of a name, for the tile drawn when there is no picture. */
export function monogramOf(name: string): string {
  const text = String(name ?? '').trim();
  const first = Array.from(text)[0];
  return first === undefined ? '?' : first.toUpperCase();
}

/**
 * A stable colour for a monogram. Eight muted, saturated colours that work on
 * the manager's light and dark themes; the hash is over the site's host, so
 * the same shortcut is the same colour in every window and after a sync.
 */
export const MONOGRAM_COLORS = [
  '#3B6FD4',
  '#2F8F6B',
  '#B4562F',
  '#7A4FBF',
  '#B33A6B',
  '#2C7F94',
  '#8A6A1F',
  '#5B6B7A',
] as const;

export function iconColorOf(key: string): string {
  const text = String(key ?? '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % MONOGRAM_COLORS.length;
  return MONOGRAM_COLORS[index];
}
