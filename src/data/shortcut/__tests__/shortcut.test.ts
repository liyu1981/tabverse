import { describe, expect, test } from 'vitest';

import {
  SHORTCUT_ORDER_ALPHABETICAL,
  SHORTCUT_ORDER_NEWEST,
  Shortcut,
  newEmptyShortcut,
  normalizeShortcutUrl,
  orderShortcuts,
  removeShortcut,
  shortcutDisplayName,
  shortcutFromPage,
  shortcutHostOf,
  shortcutWithUrl,
  upsertShortcut,
} from '../Shortcut';

function shortcut(overrides: Partial<Shortcut>): Shortcut {
  return {
    ...newEmptyShortcut(),
    id: overrides.url ?? 'id',
    createdAt: 1,
    updatedAt: 1,
    name: overrides.name ?? 'name',
    url: overrides.url ?? 'https://example.com/',
    ...overrides,
  };
}

describe('normalizeShortcutUrl', () => {
  test('keeps the page, drops the fragment', () => {
    expect(normalizeShortcutUrl('https://Example.com/a/b#section')).toBe(
      'https://example.com/a/b',
    );
    expect(normalizeShortcutUrl('http://example.com/?q=1#h')).toBe(
      'http://example.com/?q=1',
    );
  });

  test('an empty path is the root, not a second url', () => {
    expect(normalizeShortcutUrl('https://example.com')).toBe(
      'https://example.com/',
    );
    expect(normalizeShortcutUrl('  https://example.com/  ')).toBe(
      'https://example.com/',
    );
  });

  test('anything another device could not open is refused', () => {
    expect(normalizeShortcutUrl('chrome://settings')).toBe('');
    expect(normalizeShortcutUrl('file:///tmp/a.html')).toBe('');
    expect(normalizeShortcutUrl('javascript:alert(1)')).toBe('');
    expect(normalizeShortcutUrl('not a url')).toBe('');
    expect(normalizeShortcutUrl('')).toBe('');
  });
});

describe('shortcutFromPage', () => {
  test('takes the page title, and falls back to the host', () => {
    const named = shortcutFromPage({
      name: '  Figma  ',
      url: 'https://www.figma.com/file/1#x',
    });
    expect(named?.name).toBe('Figma');
    expect(named?.url).toBe('https://www.figma.com/file/1');

    const unnamed = shortcutFromPage({ url: 'https://www.example.com/a' });
    expect(unnamed?.name).toBe('example.com');
  });

  test('stores the icon fields it is given and stamps the base times', () => {
    const created = shortcutFromPage(
      { name: 'x', url: 'https://x.dev/', favIconUrl: 'https://x.dev/f.ico' },
      { iconDataUrl: 'data:image/png;base64,AAA', iconUrl: 'https://x.dev/i' },
    );
    expect(created?.iconDataUrl).toBe('data:image/png;base64,AAA');
    expect(created?.iconUrl).toBe('https://x.dev/i');
    expect(created?.favIconUrl).toBe('https://x.dev/f.ico');
    expect(created?.createdAt).toBeGreaterThan(0);
    expect(created?.updatedAt).toBeGreaterThan(0);
  });

  test('a page that cannot be a shortcut makes no row', () => {
    expect(shortcutFromPage({ url: 'chrome://settings' })).toBeNull();
  });
});

test('shortcutHostOf drops www and survives junk', () => {
  expect(shortcutHostOf('https://www.example.com/x')).toBe('example.com');
  expect(shortcutHostOf('https://sub.example.com/')).toBe('sub.example.com');
  expect(shortcutHostOf('nope')).toBe('');
});

test('shortcutDisplayName prefers the name over the host', () => {
  expect(shortcutDisplayName({ name: '  ', url: 'https://example.com/' })).toBe(
    'example.com',
  );
  expect(shortcutDisplayName({ name: 'Mine', url: 'https://x.dev/' })).toBe(
    'Mine',
  );
});

test('shortcutWithUrl compares normalized urls', () => {
  const list = [shortcut({ url: 'https://example.com/one' })];
  expect(shortcutWithUrl(list, 'https://example.com/one#x')).toBe(list[0]);
  expect(shortcutWithUrl(list, 'https://example.com/two')).toBeUndefined();
  expect(shortcutWithUrl(list, 'chrome://settings')).toBeUndefined();
});

describe('orderShortcuts', () => {
  const b = shortcut({
    id: 'b',
    name: 'beta',
    url: 'https://b.example/',
    createdAt: 2,
  });
  const a = shortcut({
    id: 'a',
    name: 'Alpha',
    url: 'https://a.example/',
    createdAt: 3,
  });
  const c = shortcut({
    id: 'c',
    name: 'alpha',
    url: 'https://c.example/',
    createdAt: 1,
  });

  test('alphabetical is case-insensitive, with the url as the tiebreak', () => {
    const ordered = orderShortcuts([b, a, c], SHORTCUT_ORDER_ALPHABETICAL);
    expect(ordered.map((item) => item.name)).toEqual([
      'Alpha',
      'alpha',
      'beta',
    ]);
    // Alpha/a.example before alpha/c.example, on the url tiebreak
    expect(ordered.map((item) => item.url)).toEqual([
      'https://a.example/',
      'https://c.example/',
      'https://b.example/',
    ]);
  });

  test('newest first is createdAt descending, then name', () => {
    const ordered = orderShortcuts([b, a, c], SHORTCUT_ORDER_NEWEST);
    expect(ordered.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  test('the input is not mutated', () => {
    const input = [b, a, c];
    orderShortcuts(input, SHORTCUT_ORDER_NEWEST);
    expect(input.map((item) => item.id)).toEqual(['b', 'a', 'c']);
  });
});

test('upsert replaces by id and remove drops by id', () => {
  const one = shortcut({ id: 'one', url: 'https://one.example/' });
  const two = shortcut({ id: 'two', url: 'https://two.example/' });
  const list = upsertShortcut([one], two);
  expect(list.map((item) => item.id)).toEqual(['one', 'two']);

  const replaced = upsertShortcut(list, { ...one, name: 'renamed' });
  expect(replaced).toHaveLength(2);
  expect(replaced.find((item) => item.id === 'one')?.name).toBe('renamed');
  expect(removeShortcut(replaced, 'one').map((item) => item.id)).toEqual([
    'two',
  ]);
});
