import { describe, expect, test } from 'vitest';

import {
  MONOGRAM_COLORS,
  absoluteIconUrl,
  iconColorOf,
  isAppleTouchRel,
  isIconRel,
  monogramOf,
  parseIconSizes,
  pickBestIconUrl,
  safeIconUrl,
} from '../icon';

const page = 'https://example.com/tools/app';

describe('parseIconSizes', () => {
  test('takes the largest edge of every pair, biggest first', () => {
    expect(parseIconSizes('32x32 64x64')).toEqual([64, 32]);
    expect(parseIconSizes('180x180')).toEqual([180]);
    expect(parseIconSizes('16x16 16x16')).toEqual([16]);
  });

  test('any and junk mean no declared size', () => {
    expect(parseIconSizes('any')).toEqual([]);
    expect(parseIconSizes(null)).toEqual([]);
    expect(parseIconSizes('')).toEqual([]);
  });
});

test('rel parsing is token based and case insensitive', () => {
  expect(isAppleTouchRel('apple-touch-icon')).toBe(true);
  expect(isAppleTouchRel('APPLE-TOUCH-ICON-PRECOMPOSED')).toBe(true);
  expect(isIconRel('shortcut icon')).toBe(true);
  expect(isIconRel('stylesheet')).toBe(false);
});

describe('pickBestIconUrl', () => {
  test('an apple-touch-icon beats a bigger plain icon', () => {
    expect(
      pickBestIconUrl(
        [
          { href: '/icon-512.png', rel: 'icon', sizes: [512] },
          { href: '/apple.png', rel: 'apple-touch-icon', sizes: [180] },
        ],
        page,
      ),
    ).toBe('https://example.com/apple.png');
  });

  test('within a kind the largest declared size wins', () => {
    expect(
      pickBestIconUrl(
        [
          { href: '/small.png', rel: 'icon', sizes: [32] },
          { href: '/big.png', rel: 'icon', sizes: [256] },
        ],
        page,
      ),
    ).toBe('https://example.com/big.png');
  });

  test('relative hrefs resolve against the page', () => {
    expect(
      pickBestIconUrl(
        [{ href: '../icons/app.png', rel: 'icon', sizes: [] }],
        'https://example.com/tools/app',
      ),
    ).toBe('https://example.com/icons/app.png');
  });

  test('hostile and browser-internal urls are dropped', () => {
    expect(
      pickBestIconUrl(
        [
          { href: 'javascript:alert(1)', rel: 'icon', sizes: [512] },
          { href: 'chrome://favicon/x', rel: 'apple-touch-icon', sizes: [180] },
        ],
        page,
      ),
    ).toBe('');
  });

  test('no links is no icon', () => {
    expect(pickBestIconUrl([], page)).toBe('');
  });
});

describe('safeIconUrl', () => {
  test('http(s) and a small data image pass', () => {
    expect(safeIconUrl('https://example.com/i.png')).toBe(
      'https://example.com/i.png',
    );
    expect(safeIconUrl('data:image/png;base64,AAA')).toBe(
      'data:image/png;base64,AAA',
    );
  });

  test('other schemes and huge data urls are refused', () => {
    expect(safeIconUrl('javascript:alert(1)')).toBe('');
    expect(safeIconUrl('chrome://favicon/x')).toBe('');
    expect(safeIconUrl('file:///tmp/i.png')).toBe('');
    expect(safeIconUrl(`data:image/png;base64,${'A'.repeat(70_000)}`)).toBe('');
  });

  test('absoluteIconUrl resolves relative links and keeps data images', () => {
    expect(absoluteIconUrl('/i.png', page)).toBe('https://example.com/i.png');
    expect(absoluteIconUrl('data:image/png;base64,AAA', page)).toBe(
      'data:image/png;base64,AAA',
    );
    expect(absoluteIconUrl('javascript:alert(1)', page)).toBe('');
  });
});

test('the monogram is the first letter, or a question mark', () => {
  expect(monogramOf('  figma')).toBe('F');
  expect(monogramOf('Ölçüm')).toBe('Ö');
  expect(monogramOf('')).toBe('?');
  expect(monogramOf('   ')).toBe('?');
});

test('the monogram colour is stable and from the palette', () => {
  const first = iconColorOf('example.com');
  expect(first).toBe(iconColorOf('example.com'));
  expect(MONOGRAM_COLORS).toContain(first);
  expect(iconColorOf('')).toBe(iconColorOf(''));
});
