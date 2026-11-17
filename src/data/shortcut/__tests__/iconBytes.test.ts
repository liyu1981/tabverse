import { describe, expect, test } from 'vitest';

import {
  MAX_ICON_DATA_URL_CHARS,
  MAX_ICON_SOURCE_BYTES,
  IconFetchDeps,
  bytesToBase64,
  dataUrlOf,
  fetchIconAsDataUrl,
  iconTargetSize,
  svgDataUrl,
} from '../iconBytes';

function responseOf(
  body: BodyInit | null,
  contentType: string,
  status = 200,
): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': contentType },
  });
}

/** A fake bitmap/encoder: the real ones need a browser's canvas. */
function fakeBitmap(width = 180, height = 180) {
  return {
    width,
    height,
    close: () => undefined,
  } as unknown as ImageBitmap;
}

function depsOf(overrides: Partial<IconFetchDeps> = {}): IconFetchDeps {
  return {
    fetchFn: async () => responseOf(new Uint8Array([1, 2, 3]), 'image/png'),
    decode: async () => fakeBitmap(),
    encode: async (_bitmap, size) =>
      new Blob([new Uint8Array([size.width, size.height])], {
        type: 'image/png',
      }),
    ...overrides,
  };
}

describe('iconTargetSize', () => {
  test('caps the long edge and keeps the aspect', () => {
    expect(iconTargetSize(512, 256)).toEqual({ width: 128, height: 64 });
    expect(iconTargetSize(256, 512)).toEqual({ width: 64, height: 128 });
  });

  test('never upscales a small favicon', () => {
    expect(iconTargetSize(32, 32)).toEqual({ width: 32, height: 32 });
    expect(iconTargetSize(16, 8)).toEqual({ width: 16, height: 8 });
  });

  test('a zero dimension is not an image', () => {
    expect(iconTargetSize(0, 10)).toEqual({ width: 0, height: 0 });
    expect(iconTargetSize(10, 0)).toEqual({ width: 0, height: 0 });
  });
});

test('bytesToBase64 converts in chunks', () => {
  expect(bytesToBase64(new Uint8Array([104, 105]))).toBe('aGk=');
  const big = new Uint8Array(70_000).fill(65);
  expect(bytesToBase64(big)).toBe(Buffer.from(big).toString('base64'));
});

test('dataUrlOf builds the header the img tag reads', () => {
  expect(dataUrlOf('image/png', new Uint8Array([1]))).toBe(
    'data:image/png;base64,AQ==',
  );
});

describe('svgDataUrl', () => {
  test('a small svg is stored as text', () => {
    const url = svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(url).toContain('%3Csvg');
  });

  test('an oversized svg is refused, not truncated', () => {
    expect(svgDataUrl(`<svg>${'x'.repeat(20_000)}</svg>`)).toBe('');
  });
});

describe('fetchIconAsDataUrl', () => {
  test('fetches, rasterizes and returns a PNG data url', async () => {
    const url = await fetchIconAsDataUrl('https://x.dev/i.png', depsOf());
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    // the fake encoder wrote the target size into the bytes: 180 -> 128
    const payload = Uint8Array.from(atob(url.split(',')[1] ?? ''), (c) =>
      c.charCodeAt(0),
    );
    expect(Array.from(payload)).toEqual([128, 128]);
  });

  test('retries at the smaller edge when the first png is over budget', async () => {
    const sizes: number[] = [];
    const url = await fetchIconAsDataUrl(
      'https://x.dev/i.png',
      depsOf({
        encode: async (_bitmap, size) => {
          sizes.push(size.width);
          const length = size.width === 128 ? MAX_ICON_DATA_URL_CHARS + 10 : 10;
          return new Blob([new Uint8Array(length)], { type: 'image/png' });
        },
      }),
    );
    expect(sizes).toEqual([128, 64]);
    expect(url).not.toBe('');
    expect(url.length).toBeLessThanOrEqual(MAX_ICON_DATA_URL_CHARS);
  });

  test('every failure is an empty string', async () => {
    expect(await fetchIconAsDataUrl('')).toBe('');
    expect(await fetchIconAsDataUrl('javascript:alert(1)', depsOf())).toBe('');
    expect(
      await fetchIconAsDataUrl(
        'https://x.dev/i.png',
        depsOf({
          fetchFn: async () => responseOf('nope', 'text/html'),
        }),
      ),
    ).toBe('');
    expect(
      await fetchIconAsDataUrl(
        'https://x.dev/i.png',
        depsOf({ fetchFn: async () => responseOf(null, 'image/png', 404) }),
      ),
    ).toBe('');
    expect(
      await fetchIconAsDataUrl(
        'https://x.dev/i.png',
        depsOf({ fetchFn: async () => responseOf('x', 'image/png', 500) }),
      ),
    ).toBe('');
    expect(
      await fetchIconAsDataUrl(
        'https://x.dev/i.png',
        depsOf({
          fetchFn: async () =>
            responseOf(new Uint8Array(MAX_ICON_SOURCE_BYTES + 1), 'image/png'),
        }),
      ),
    ).toBe('');
    expect(
      await fetchIconAsDataUrl(
        'https://x.dev/i.png',
        depsOf({
          decode: async () => {
            throw new Error('not decodable');
          },
          // an icon format the browser cannot decode, and not in the fallback
          // list for its content type either
          fetchFn: async () => responseOf('x', 'image/avif'),
        }),
      ),
    ).toBe('');
  });

  test('an undecodable png falls back to its own bytes', async () => {
    const url = await fetchIconAsDataUrl(
      'https://x.dev/i.png',
      depsOf({
        decode: async () => {
          throw new Error('not decodable');
        },
        encode: async () => {
          throw new Error('not encodable');
        },
        fetchFn: async () => responseOf(new Uint8Array([9, 8, 7]), 'image/png'),
      }),
    );
    expect(url).toBe('data:image/png;base64,CQgH');
  });

  test('a small data: source is already the answer', async () => {
    const source = 'data:image/png;base64,AAA';
    expect(await fetchIconAsDataUrl(source, depsOf())).toBe(source);
    expect(
      await fetchIconAsDataUrl(
        `data:image/png;base64,${'A'.repeat(MAX_ICON_DATA_URL_CHARS)}`,
        depsOf(),
      ),
    ).toBe('');
  });

  test('an svg is stored as text without decoding', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const url = await fetchIconAsDataUrl(
      'https://x.dev/i.svg',
      depsOf({
        fetchFn: async () => responseOf(svg, 'image/svg+xml'),
        decode: async () => {
          throw new Error('the svg must not be rasterised');
        },
      }),
    );
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
  });

  test('a hanging fetch is abandoned at the timeout', async () => {
    const started = Date.now();
    const url = await fetchIconAsDataUrl(
      'https://x.dev/i.png',
      depsOf({
        timeoutMs: 10,
        fetchFn: (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new Error('aborted')),
            );
          }),
      }),
    );
    expect(url).toBe('');
    expect(Date.now() - started).toBeGreaterThanOrEqual(5);
  });
});
